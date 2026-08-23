package com.h0x91b.dev3

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.res.ColorStateList
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.os.SystemClock
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.KeyEvent
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.view.inputmethod.BaseInputConnection
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import android.util.Base64
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {
	private data class PendingFileSave(
		val requestId: String,
		val base64: String? = null,
		val remoteUrl: String? = null,
		val expectedBytes: Long? = null,
		val mime: String,
		val fileName: String,
	)

	companion object {
		private const val NOTIFICATION_CHANNEL_ID = "dev3-agent-events"
		private const val EXTRA_TASK_ID = "dev3-task-id"
		private const val EXTRA_PROJECT_ID = "dev3-project-id"
		private const val MAX_SAVED_FILE_BASE64_CHARS = 35 * 1024 * 1024
		private const val MAX_REMOTE_FILE_BYTES = 128L * 1024 * 1024
		private const val MAX_OPEN_HTML_CHARS = 10 * 1024 * 1024
		private const val MAX_SAVED_DRAFT_CHARS = 500_000
		private const val DRAFTS_STATE_KEY = "dev3-drafts"
	}

	private lateinit var root: FrameLayout
	private lateinit var connectionStore: ConnectionStore
	private var webView: WebView? = null
	private var webBridge: Dev3WebBridge? = null
	private var composer: LinearLayout? = null
	private var composerLabel: TextView? = null
	private var composerInput: EditText? = null
	private var composerStatus: TextView? = null
	private var insertButton: Button? = null
	private var sendButton: Button? = null
	private var activeContext: TerminalContext? = null
	private var currentTarget: ConnectionTarget? = null
	private var exitArmedUntil = 0L
	private var sending = false
	private val drafts = NativePromptDrafts()
	private var fileCallback: ValueCallback<Array<Uri>>? = null
	private var pendingFileSave: PendingFileSave? = null
	private var pendingNotificationPermissionRequest: String? = null
	private var pendingOpenTask: Pair<String, String>? = null
	private var trustedBridgePage = false
	private var lastRendererCrashAt = 0L
	private var bridgeReady = false
	private var hostStatusLabel: TextView? = null
	private var logoutPending = false
	private val devicePreferences by lazy { getSharedPreferences("dev3-device", MODE_PRIVATE) }

	private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
		val callback = fileCallback ?: return@registerForActivityResult
		fileCallback = null
		callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
	}
	private val fileSavePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
		val pending = pendingFileSave ?: return@registerForActivityResult
		pendingFileSave = null
		val uri = result.data?.data
		if (result.resultCode != RESULT_OK || uri == null) {
			webBridge?.postDeviceResult(pending.requestId, false, error = "File save cancelled")
			return@registerForActivityResult
		}
		Thread {
			val result = runCatching {
				if (pending.remoteUrl != null) {
					streamRemoteFile(pending, uri)
				} else {
					val bytes = Base64.decode(pending.base64 ?: error("Missing download data"), Base64.DEFAULT)
					contentResolver.openOutputStream(uri, "w")?.use { it.write(bytes) }
						?: error("Unable to open the selected file")
				}
			}
			runOnUiThread {
				result.onSuccess {
					webBridge?.postDeviceResult(pending.requestId, true)
				}.onFailure {
					runCatching { contentResolver.delete(uri, null, null) }
					webBridge?.postDeviceResult(pending.requestId, false, error = it.message ?: "File save failed")
				}
			}
		}.start()
	}
	private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
		val requestId = pendingNotificationPermissionRequest
		pendingNotificationPermissionRequest = null
		val capabilities = capabilitiesJson()
		if (requestId != null) webBridge?.postDeviceResult(requestId, true, capabilities)
		postCapabilities()
	}

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		enableEdgeToEdge()
		connectionStore = ConnectionStore(this)
		restoreDrafts(savedInstanceState)
		root = FrameLayout(this).apply { setBackgroundResource(R.color.surface_base) }
		ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
			val safe = insets.getInsets(
				WindowInsetsCompat.Type.systemBars() or
					WindowInsetsCompat.Type.displayCutout() or
					WindowInsetsCompat.Type.ime(),
			)
			view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
			insets
		}
		setContentView(root)
		ViewCompat.requestApplyInsets(root)
		createNotificationChannel()
		captureNotificationIntent(intent)
		installBackHandler()

		val saved = connectionStore.load()
		if (saved == null) showConnection() else connect(saved)
	}

	override fun onDestroy() {
		webBridge?.detach()
		webView?.destroy()
		super.onDestroy()
	}

	override fun onSaveInstanceState(outState: Bundle) {
		activeContext?.let { drafts.put(it.key, composerInput?.text?.toString().orEmpty()) }
		val savedDrafts = Bundle()
		for ((key, value) in drafts.snapshot(MAX_SAVED_DRAFT_CHARS)) savedDrafts.putString(key, value)
		outState.putBundle(DRAFTS_STATE_KEY, savedDrafts)
		super.onSaveInstanceState(outState)
	}

	override fun onNewIntent(intent: Intent) {
		super.onNewIntent(intent)
		setIntent(intent)
		captureNotificationIntent(intent)
		postPendingTaskNavigation()
	}

	private fun installBackHandler() {
		onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
				override fun handleOnBackPressed() {
				if (SystemClock.elapsedRealtime() < exitArmedUntil) {
					finish()
					return
				}
				val view = webView
				if (view == null) {
					finish()
					return
				}
				if (composerInput?.hasFocus() == true) {
					composerInput?.clearFocus()
					getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(composerInput?.windowToken, 0)
					return
				}
				view.evaluateJavascript("window.history.back()", null)
			}
		})
	}

	private fun restoreDrafts(state: Bundle?) {
		val saved = state?.getBundle(DRAFTS_STATE_KEY) ?: return
		drafts.restore(saved.keySet().mapNotNull { key -> saved.getString(key)?.let { key to it } }.toMap())
	}

	private fun showConnection(message: String? = null) {
		currentTarget = null
		exitArmedUntil = 0L
		webBridge?.detach()
		webBridge = null
		webView?.destroy()
		webView = null
		hostStatusLabel = null
		root.removeAllViews()

		val panel = LinearLayout(this).apply {
			orientation = LinearLayout.VERTICAL
			gravity = Gravity.CENTER_HORIZONTAL
			setPadding(dp(32), dp(48), dp(32), dp(32))
		}
		val title = textView(R.string.connect_title, 26f, R.color.text_primary)
		val description = textView(R.string.connect_description, 16f, R.color.text_secondary).apply {
			gravity = Gravity.CENTER
			setPadding(0, dp(12), 0, dp(28))
		}
		val scan = Button(this).apply {
			setText(R.string.scan_qr)
			isAllCaps = false
			minHeight = dp(48)
			backgroundTintList = ColorStateList.valueOf(color(R.color.accent_fill))
			setTextColor(Color.WHITE)
			setOnClickListener { scanQr() }
		}
		val linkLabel = textView(R.string.connection_link_label, 14f, R.color.text_secondary).apply {
			setPadding(0, dp(28), 0, dp(6))
		}
		val link = EditText(this).apply {
			id = View.generateViewId()
			hint = getString(R.string.connection_link_hint)
			setHintTextColor(color(R.color.text_muted))
			setTextColor(color(R.color.text_primary))
			setSingleLine(true)
			setPadding(dp(14), dp(12), dp(14), dp(12))
			backgroundTintList = ColorStateList.valueOf(color(R.color.accent_fill))
		}
		linkLabel.labelFor = link.id
		val connect = Button(this).apply {
			setText(R.string.connect)
			isAllCaps = false
			minHeight = dp(48)
			setOnClickListener { connect(link.text.toString()) }
		}
		val status = textView(0, 14f, R.color.danger).apply {
			text = message.orEmpty()
			visibility = if (message.isNullOrBlank()) View.GONE else View.VISIBLE
			setPadding(0, dp(16), 0, 0)
			accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
		}

		panel.addView(title, matchWrap())
		panel.addView(description, matchWrap())
		panel.addView(scan, matchWrap())
		panel.addView(linkLabel, matchWrap())
		panel.addView(link, matchWrap())
		panel.addView(connect, matchWrap(top = 12))
		panel.addView(status, matchWrap())
		val scroll = ScrollView(this).apply { addView(panel, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) }
		root.addView(scroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
	}

	private fun scanQr() {
		val options = GmsBarcodeScannerOptions.Builder()
			.setBarcodeFormats(Barcode.FORMAT_QR_CODE)
			.enableAutoZoom()
			.build()
		GmsBarcodeScanning.getClient(this, options).startScan()
			.addOnSuccessListener { barcode -> barcode.rawValue?.let { connect(it) } }
			.addOnFailureListener { showConnection(getString(R.string.scanner_failed)) }
	}

	private fun connect(rawUrl: String, allowUnsafeCleartext: Boolean = false) {
		val target = try {
			ConnectionUrl.parse(rawUrl)
		} catch (error: ConnectionUrlException) {
			val message = if (error.reason == ConnectionUrlException.Reason.PUBLIC_CLEARTEXT) {
				getString(R.string.public_http_blocked)
			} else {
				getString(R.string.invalid_connection)
			}
			showConnection(message)
			return
		}

		if (!supportsSecureBridge()) {
			showConnection(getString(R.string.webview_update_required))
			return
		}
		if (target.unsafeCleartext && !allowUnsafeCleartext) {
			showUnsafeConnection(target)
			return
		}

		showWebApp(target)
	}

	private fun showUnsafeConnection(target: ConnectionTarget) {
		root.removeAllViews()
		val panel = LinearLayout(this).apply {
			orientation = LinearLayout.VERTICAL
			gravity = Gravity.CENTER_HORIZONTAL
			setPadding(dp(32), dp(48), dp(32), dp(32))
		}
		panel.addView(textView(R.string.unsafe_connection_title, 26f, R.color.warning), matchWrap())
		panel.addView(textView(R.string.unsafe_connection_description, 16f, R.color.text_secondary).apply {
			gravity = Gravity.CENTER
			setPadding(0, dp(12), 0, dp(28))
		}, matchWrap())
		panel.addView(Button(this).apply {
			setText(R.string.go_back)
			isAllCaps = false
			minHeight = dp(48)
			setOnClickListener { showConnection() }
		}, matchWrap())
		panel.addView(Button(this).apply {
			setText(R.string.connect_anyway)
			isAllCaps = false
			minHeight = dp(48)
			backgroundTintList = ColorStateList.valueOf(color(R.color.warning))
			setTextColor(Color.BLACK)
			setOnClickListener { connect(target.initialUrl, allowUnsafeCleartext = true) }
		}, matchWrap(top = 12))
		val scroll = ScrollView(this).apply { addView(panel, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) }
		root.addView(scroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
	}

	private fun supportsSecureBridge(): Boolean {
		return WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
			WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
	}

	private fun showWebApp(target: ConnectionTarget) {
		root.removeAllViews()
		currentTarget = target
		bridgeReady = false
		val shell = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
		createHostBar(shell)
		val browser = WebView(this)
		webView = browser
		configureWebView(browser, target)
		shell.addView(browser, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
		createComposer(shell)
		root.addView(shell, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
		browser.loadUrl(target.initialUrl)
		root.postDelayed({
			if (!bridgeReady && currentTarget == target) {
				hostStatusLabel?.setText(R.string.bridge_update_required)
				hostStatusLabel?.setTextColor(color(R.color.warning))
			}
		}, 12_000)
	}

	private fun configureWebView(browser: WebView, target: ConnectionTarget) {
		browser.settings.apply {
			javaScriptEnabled = true
			domStorageEnabled = true
			allowFileAccess = false
			allowContentAccess = true
			setSupportMultipleWindows(true)
			userAgentString = "$userAgentString Dev3Android/0.1"
			cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
		}
		CookieManager.getInstance().apply {
			setAcceptCookie(true)
			setAcceptThirdPartyCookies(browser, false)
		}
		WebViewCompat.addDocumentStartJavaScript(
			browser,
			"window.__DEV3_ANDROID_APP__=true;",
			setOf(target.origin),
		)
		webBridge = Dev3WebBridge(
			target.origin,
			::onTerminalContext,
			::onAuthFailed,
			::onConnectionState,
			::onBackOutcome,
			::onAppendDraft,
			::onBridgeReady,
			::onDeviceRequest,
			{ trustedBridgePage },
			::onLogoutResult,
		).also { it.attach(browser) }

		browser.webViewClient = object : WebViewClient() {
			override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
				trustedBridgePage = isTrustedBridgeUrl(url, target)
			}

				override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
				if (!request.isForMainFrame) return false
				val next = request.url
				val staysInApp = runCatching { ConnectionUrl.parse(next.toString()).origin == target.origin }.getOrDefault(false)
				if (staysInApp) return false
				if (!request.hasGesture() || next.scheme !in setOf("http", "https", "mailto")) {
					android.widget.Toast.makeText(this@MainActivity, R.string.external_navigation_blocked, android.widget.Toast.LENGTH_SHORT).show()
					return true
				}
				runCatching { startActivity(Intent(Intent.ACTION_VIEW, next)) }
				return true
			}

			override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
				handler.cancel()
			}

			override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
				val now = SystemClock.elapsedRealtime()
				webBridge?.detach()
				webBridge = null
				(view.parent as? ViewGroup)?.removeView(view)
				view.destroy()
				webView = null
				if (now - lastRendererCrashAt < 30_000) {
					showConnection(getString(R.string.webview_crashed))
				} else {
					lastRendererCrashAt = now
					showWebApp(target)
				}
				return true
			}
		}
		browser.webChromeClient = object : WebChromeClient() {
			override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
				if (!isUserGesture) return false
				val popup = WebView(this@MainActivity)
				popup.webViewClient = object : WebViewClient() {
					override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
						if (url == "about:blank") return
						val uri = Uri.parse(url)
						if (uri.scheme in setOf("http", "https", "mailto")) {
							runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
						}
						view.destroy()
					}

					override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
						view.destroy()
						return true
					}
				}
				val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false
				transport.webView = popup
				resultMsg.sendToTarget()
				return true
			}

			override fun onShowFileChooser(
				webView: WebView,
				filePathCallback: ValueCallback<Array<Uri>>,
				fileChooserParams: FileChooserParams,
			): Boolean {
				fileCallback?.onReceiveValue(null)
				fileCallback = filePathCallback
				return try {
					filePicker.launch(fileChooserParams.createIntent())
					true
				} catch (_: Exception) {
					fileCallback = null
					filePathCallback.onReceiveValue(null)
					false
				}
			}
		}
	}

	private fun isTrustedBridgeUrl(url: String, target: ConnectionTarget): Boolean {
		return runCatching { ConnectionUrl.parse(url).origin == target.origin }.getOrDefault(false)
	}

	private fun createHostBar(parent: LinearLayout) {
		val bar = LinearLayout(this).apply {
			orientation = LinearLayout.HORIZONTAL
			gravity = Gravity.CENTER_VERTICAL
			setPadding(dp(12), 0, dp(4), 0)
			setBackgroundResource(R.color.surface_raised)
		}
		val unsafe = currentTarget?.unsafeCleartext == true
		val label = textView(
			if (unsafe) R.string.connected_unencrypted else R.string.connected_computer,
			14f,
			if (unsafe) R.color.warning else R.color.text_secondary,
		)
		hostStatusLabel = label
		val menuButton = Button(this).apply {
			text = "⋮"
			contentDescription = getString(R.string.connection_options)
			isAllCaps = false
			minWidth = dp(48)
			minHeight = dp(48)
			setOnClickListener { showConnectionMenu(this) }
		}
		bar.addView(label, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
		bar.addView(menuButton, LinearLayout.LayoutParams(dp(48), dp(48)))
		parent.addView(bar, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
	}

	private fun showConnectionMenu(anchor: View) {
		PopupMenu(this, anchor).apply {
			menu.add(0, 1, 0, R.string.switch_computer)
			menu.add(0, 2, 1, R.string.forget_computer)
			setOnMenuItemClickListener { item ->
				connectionStore.clear()
				if (item.itemId == 2) {
					requestSessionLogout()
				} else {
					showConnection()
				}
				true
			}
			show()
		}
	}

	private fun createComposer(parent: ViewGroup) {
		val bar = LinearLayout(this).apply {
			orientation = LinearLayout.VERTICAL
			setPadding(dp(12), dp(8), dp(12), dp(10))
			setBackgroundResource(R.color.surface_raised)
			visibility = View.GONE
		}
		val label = textView(R.string.prompt_task_label, 13f, R.color.text_secondary)
		val input = EditText(this).apply {
			id = View.generateViewId()
			hint = getString(R.string.prompt_hint)
			setHintTextColor(color(R.color.text_muted))
			setTextColor(color(R.color.text_primary))
			gravity = Gravity.TOP or Gravity.START
			minLines = 2
			maxLines = 6
			inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
			setPadding(dp(12), dp(10), dp(12), dp(10))
			backgroundTintList = ColorStateList.valueOf(color(R.color.accent_fill))
			setOnKeyListener { _, keyCode, event ->
				val composing = BaseInputConnection.getComposingSpanStart(text) >= 0
				if (!composing && keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN && (event.isCtrlPressed || event.isMetaPressed)) {
					deliver("submit")
					true
				} else false
			}
		}
		label.labelFor = input.id
		val status = textView(0, 13f, R.color.danger).apply {
			visibility = View.GONE
			accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
		}
		val actions = LinearLayout(this).apply {
			orientation = LinearLayout.HORIZONTAL
			gravity = Gravity.END
			setPadding(0, dp(8), 0, 0)
		}
		val insert = Button(this).apply {
			setText(R.string.insert)
			isAllCaps = false
			minHeight = dp(48)
			setOnClickListener { deliver("insert") }
		}
		val send = Button(this).apply {
			setText(R.string.send)
			isAllCaps = false
			minHeight = dp(48)
			backgroundTintList = ColorStateList.valueOf(color(R.color.accent_fill))
			setTextColor(Color.WHITE)
			setOnClickListener { deliver("submit") }
		}
		input.addTextChangedListener(object : TextWatcher {
			override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit
			override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) = Unit
			override fun afterTextChanged(text: Editable?) {
				val enabled = !sending && !text.isNullOrBlank()
				insert.isEnabled = enabled
				send.isEnabled = enabled
			}
		})
		insert.isEnabled = false
		send.isEnabled = false

		actions.addView(insert, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
		actions.addView(send, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(8) })
		bar.addView(label, matchWrap())
		bar.addView(input, matchWrap(top = 6))
		bar.addView(status, matchWrap())
		bar.addView(actions, matchWrap())

		composer = bar
		composerLabel = label
		composerInput = input
		composerStatus = status
		insertButton = insert
		sendButton = send
		parent.addView(bar, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
	}

	private fun onTerminalContext(next: TerminalContext?) {
		runOnUiThread {
			val previous = activeContext
			if (previous != null) drafts.put(previous.key, composerInput?.text?.toString().orEmpty())
			activeContext = next
			if (next == null || next.rawMode) {
				composerInput?.clearFocus()
				getSystemService(InputMethodManager::class.java)?.hideSoftInputFromWindow(composerInput?.windowToken, 0)
				composer?.visibility = View.GONE
				return@runOnUiThread
			}
			composerLabel?.setText(if (next.kind == "task") R.string.prompt_task_label else R.string.prompt_project_label)
			composerInput?.setText(drafts.get(next.key))
			composerInput?.setSelection(composerInput?.text?.length ?: 0)
			composerStatus?.visibility = View.GONE
			composer?.visibility = View.VISIBLE
		}
	}

	private fun onAuthFailed() {
		runOnUiThread {
			connectionStore.clear()
			clearCurrentSession { showConnection(getString(R.string.session_expired)) }
		}
	}

	private fun requestSessionLogout() {
		if (logoutPending) return
		logoutPending = true
		val posted = webBridge?.postToPage(JSONObject().put("type", "logout-request")) == true
		if (!posted) {
			onLogoutResult()
			return
		}
		root.postDelayed({ if (logoutPending) onLogoutResult() }, 2_000)
	}

	private fun onLogoutResult() {
		runOnUiThread {
			if (!logoutPending) return@runOnUiThread
			logoutPending = false
			clearCurrentSession { showConnection() }
		}
	}

	private fun clearCurrentSession(onDone: () -> Unit) {
		val origin = currentTarget?.origin
		if (origin == null) {
			onDone()
			return
		}
		val secure = if (origin.startsWith("https://")) "; Secure" else ""
		CookieManager.getInstance().setCookie(
			origin,
			"dev3_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict$secure",
		) {
			CookieManager.getInstance().flush()
			runOnUiThread(onDone)
		}
	}

	private fun onConnectionState(state: String) {
		if (state != "connected") return
		runOnUiThread {
			currentTarget?.let { connectionStore.save(it.storedUrl) }
			CookieManager.getInstance().flush()
		}
	}

	private fun onBackOutcome(outcome: String) {
		runOnUiThread {
			exitArmedUntil = if (outcome == "exit-armed") SystemClock.elapsedRealtime() + 2_000 else 0L
		}
	}

	private fun onAppendDraft(contextKey: String, text: String) {
		runOnUiThread {
			val context = activeContext ?: return@runOnUiThread
			if (context.key != contextKey || context.rawMode) return@runOnUiThread
			composerInput?.append(text)
		}
	}

	private fun onBridgeReady(version: Int) {
		runOnUiThread {
			bridgeReady = version == 1
			if (!bridgeReady) {
				hostStatusLabel?.setText(R.string.bridge_incompatible)
				hostStatusLabel?.setTextColor(color(R.color.warning))
				return@runOnUiThread
			}
			val unsafe = currentTarget?.unsafeCleartext == true
			hostStatusLabel?.setText(if (unsafe) R.string.connected_unencrypted else R.string.connected_computer)
			hostStatusLabel?.setTextColor(color(if (unsafe) R.color.warning else R.color.text_secondary))
			postCapabilities()
			postPendingTaskNavigation()
		}
	}

	private fun onDeviceRequest(body: JSONObject) {
		val requestId = body.optString("requestId")
		val action = body.optString("action")
		val payload = body.optJSONObject("payload") ?: JSONObject()
		if (requestId.isBlank()) return
		runOnUiThread {
			if (currentTarget?.unsafeCleartext == true && action in setOf("open-external", "open-html", "show-notification")) {
				webBridge?.postDeviceResult(requestId, false, error = "This Android device action is disabled on an unencrypted connection")
				return@runOnUiThread
			}
			when (action) {
				"clipboard-write-text" -> writeClipboardText(requestId, payload.optString("text"))
				"save-file" -> saveFile(requestId, payload)
				"save-remote-file" -> saveRemoteFile(requestId, payload)
				"open-external" -> openExternal(requestId, payload.optString("url"))
				"open-html" -> openHtml(requestId, payload.optString("fileName"), payload.optString("html"))
				"show-notification" -> showDeviceNotification(requestId, payload)
				"request-notification-permission" -> requestNotificationPermission(requestId)
				else -> webBridge?.postDeviceResult(requestId, false, error = "Unsupported device action: $action")
			}
		}
	}

	private fun writeClipboardText(requestId: String, text: String) {
		getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("dev3", text))
		webBridge?.postDeviceResult(requestId, true)
	}

	private fun saveFile(requestId: String, payload: JSONObject) {
		if (pendingFileSave != null) {
			webBridge?.postDeviceResult(requestId, false, error = "Another file save is already open")
			return
		}
		val base64 = payload.optString("base64")
		val mime = payload.optString("mime").ifBlank { "application/octet-stream" }
		val fileName = safeFileName(payload.optString("fileName"), "download")
		if (base64.isBlank()) {
			webBridge?.postDeviceResult(requestId, false, error = "Download data is empty")
			return
		}
		if (base64.length > MAX_SAVED_FILE_BASE64_CHARS) {
			webBridge?.postDeviceResult(requestId, false, error = "Download is larger than the Android 25 MB safety limit")
			return
		}
		pendingFileSave = PendingFileSave(
			requestId = requestId,
			base64 = base64,
			mime = mime,
			fileName = fileName,
		)
		val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
			addCategory(Intent.CATEGORY_OPENABLE)
			type = mime
			putExtra(Intent.EXTRA_TITLE, fileName)
		}
		fileSavePicker.launch(intent)
	}

	private fun saveRemoteFile(requestId: String, payload: JSONObject) {
		if (pendingFileSave != null) {
			webBridge?.postDeviceResult(requestId, false, error = "Another file save is already open")
			return
		}
		val origin = currentTarget?.origin
		val rawUrl = payload.optString("url")
		val remoteUrl = runCatching { resolveArtifactDownloadUrl(origin.orEmpty(), rawUrl) }.getOrElse {
			webBridge?.postDeviceResult(requestId, false, error = it.message ?: "Invalid artifact download URL")
			return
		}
		val expectedBytes = payload.optLong("bytes", -1L)
		if (expectedBytes !in 1..MAX_REMOTE_FILE_BYTES) {
			webBridge?.postDeviceResult(requestId, false, error = "Download is larger than the Android 128 MB safety limit")
			return
		}
		val mime = payload.optString("mime").ifBlank { "application/octet-stream" }
		val fileName = safeFileName(payload.optString("fileName"), "download")
		pendingFileSave = PendingFileSave(
			requestId = requestId,
			remoteUrl = remoteUrl,
			expectedBytes = expectedBytes,
			mime = mime,
			fileName = fileName,
		)
		fileSavePicker.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
			addCategory(Intent.CATEGORY_OPENABLE)
			type = mime
			putExtra(Intent.EXTRA_TITLE, fileName)
		})
	}

	private fun streamRemoteFile(pending: PendingFileSave, destination: Uri) {
		val origin = currentTarget?.origin ?: error("Paired computer is unavailable")
		val url = pending.remoteUrl ?: error("Missing artifact download URL")
		val expectedBytes = pending.expectedBytes ?: error("Missing artifact download size")
		val connection = URL(url).openConnection() as? HttpURLConnection
			?: error("Artifact download must use HTTP")
		connection.instanceFollowRedirects = false
		connection.connectTimeout = 15_000
		connection.readTimeout = 60_000
		connection.setRequestProperty("Accept", pending.mime)
		connection.setRequestProperty("Origin", origin)
		CookieManager.getInstance().getCookie(origin)?.takeIf { it.isNotBlank() }?.let {
			connection.setRequestProperty("Cookie", it)
		}
		try {
			val status = connection.responseCode
			if (status != HttpURLConnection.HTTP_OK) error("Computer returned HTTP $status")
			val contentLength = connection.contentLengthLong
			if (contentLength > MAX_REMOTE_FILE_BYTES) error("Download exceeds the Android 128 MB safety limit")
			if (contentLength >= 0 && contentLength != expectedBytes) error("Download size changed before transfer")
			connection.inputStream.use { input ->
				contentResolver.openOutputStream(destination, "w")?.use { output ->
					copyExactRemoteFile(input, output, expectedBytes, MAX_REMOTE_FILE_BYTES)
				} ?: error("Unable to open the selected file")
			}
		} finally {
			connection.disconnect()
		}
	}

	private fun openExternal(requestId: String, rawUrl: String) {
		val uri = runCatching { Uri.parse(rawUrl) }.getOrNull()
		if (uri == null || uri.scheme !in setOf("http", "https", "mailto")) {
			webBridge?.postDeviceResult(requestId, false, error = "Unsupported external URL")
			return
		}
		val target = if (uri.host == "localhost" || uri.host == "127.0.0.1") rewriteLocalhost(uri) else uri
		if (target == null) {
			android.widget.Toast.makeText(this, R.string.port_requires_exposure, android.widget.Toast.LENGTH_LONG).show()
			webBridge?.postDeviceResult(requestId, false, error = "Expose this port from dev3 before opening it through a public tunnel")
			return
		}
		runCatching {
			startActivity(Intent(Intent.ACTION_VIEW, target))
		}.onSuccess {
			webBridge?.postDeviceResult(requestId, true)
		}.onFailure {
			webBridge?.postDeviceResult(requestId, false, error = it.message ?: "No app can open this URL")
		}
	}

	private fun rewriteLocalhost(uri: Uri): Uri? {
		val origin = currentTarget?.origin?.let(Uri::parse) ?: return uri
		val originHost = origin.host ?: return uri
		if (originHost.endsWith(".trycloudflare.com")) return null
		val authorityHost = if (originHost.contains(':')) "[$originHost]" else originHost
		return uri.buildUpon()
			.scheme(uri.scheme)
			.encodedAuthority(if (uri.port == -1) origin.encodedAuthority else "$authorityHost:${uri.port}")
			.build()
	}

	private fun openHtml(requestId: String, fileName: String, html: String) {
		if (html.length > MAX_OPEN_HTML_CHARS) {
			webBridge?.postDeviceResult(requestId, false, error = "Artifact HTML is larger than the 10 MB open-in-browser limit")
			return
		}
		Thread {
			val result = runCatching {
				val directory = File(cacheDir, "shared").apply { mkdirs() }
				File(directory, safeFileName(fileName, "artifact.html")).apply { writeText(html, Charsets.UTF_8) }
			}
			runOnUiThread {
				result.onSuccess { file ->
					runCatching {
						val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
						startActivity(Intent(Intent.ACTION_VIEW).apply {
							setDataAndType(uri, "text/html")
							addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
						})
					}.onSuccess {
						webBridge?.postDeviceResult(requestId, true)
					}.onFailure {
						webBridge?.postDeviceResult(requestId, false, error = it.message ?: "No browser can open this artifact")
					}
				}.onFailure {
					webBridge?.postDeviceResult(requestId, false, error = it.message ?: "Unable to prepare this artifact")
				}
			}
		}.start()
	}

	private fun requestNotificationPermission(requestId: String) {
		if (notificationPermissionState() == "granted" || Build.VERSION.SDK_INT < 33) {
			webBridge?.postDeviceResult(requestId, true, capabilitiesJson())
			return
		}
		if (pendingNotificationPermissionRequest != null) {
			webBridge?.postDeviceResult(requestId, false, error = "Notification permission request is already open")
			return
		}
		pendingNotificationPermissionRequest = requestId
		devicePreferences.edit().putBoolean("notification-permission-asked", true).apply()
		notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
	}

	private fun showDeviceNotification(requestId: String, payload: JSONObject) {
		if (notificationPermissionState() != "granted") {
			webBridge?.postDeviceResult(requestId, false, error = "Notification permission is not granted")
			return
		}
		val taskId = payload.optString("taskId")
		val projectId = payload.optString("projectId")
		val notificationId = ("$projectId:$taskId").hashCode()
		val intent = Intent(this, MainActivity::class.java).apply {
			flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
			putExtra(EXTRA_TASK_ID, taskId)
			putExtra(EXTRA_PROJECT_ID, projectId)
		}
		val pendingIntent = PendingIntent.getActivity(
			this,
			notificationId,
			intent,
			PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
		)
		val notification = android.app.Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
			.setSmallIcon(android.R.drawable.stat_notify_chat)
			.setContentTitle(payload.optString("title", getString(R.string.app_name)))
			.setContentText(payload.optString("body"))
			.setContentIntent(pendingIntent)
			.setAutoCancel(true)
			.build()
		getSystemService(NotificationManager::class.java).notify(notificationId, notification)
		webBridge?.postDeviceResult(requestId, true)
	}

	private fun createNotificationChannel() {
		getSystemService(NotificationManager::class.java).createNotificationChannel(
			NotificationChannel(
				NOTIFICATION_CHANNEL_ID,
				getString(R.string.notification_channel_name),
				NotificationManager.IMPORTANCE_DEFAULT,
			),
		)
	}

	private fun notificationPermissionState(): String {
		if (currentTarget?.unsafeCleartext == true) return "denied"
		if (getSystemService(NotificationManager::class.java).areNotificationsEnabled()) return "granted"
		if (Build.VERSION.SDK_INT < 33) return "denied"
		return if (devicePreferences.getBoolean("notification-permission-asked", false)) "denied" else "default"
	}

	private fun capabilitiesJson(): JSONObject {
		return JSONObject()
			.put("version", 1)
			.put("notificationPermission", notificationPermissionState())
			.put("clipboardImage", false)
			.put("fileSave", true)
			.put("externalOpen", currentTarget?.unsafeCleartext != true)
	}

	private fun postCapabilities() {
		webBridge?.postToPage(JSONObject().put("type", "device-capabilities").put("capabilities", capabilitiesJson()))
	}

	private fun captureNotificationIntent(intent: Intent?) {
		val taskId = intent?.getStringExtra(EXTRA_TASK_ID)
		val projectId = intent?.getStringExtra(EXTRA_PROJECT_ID)
		if (!taskId.isNullOrBlank() && !projectId.isNullOrBlank()) pendingOpenTask = taskId to projectId
	}

	private fun postPendingTaskNavigation() {
		val target = pendingOpenTask ?: return
		val posted = webBridge?.postToPage(
			JSONObject()
				.put("type", "open-task")
				.put("taskId", target.first)
				.put("projectId", target.second),
		) == true
		if (posted) pendingOpenTask = null
	}

	private fun safeFileName(value: String, fallback: String): String {
		return value.substringAfterLast('/').substringAfterLast('\\')
			.replace(Regex("[^A-Za-z0-9._ -]"), "_")
			.trim()
			.take(120)
			.ifBlank { fallback }
	}

	private fun deliver(type: String) {
		val text = composerInput?.text?.toString().orEmpty()
		val context = activeContext
		if (text.isBlank() || context == null) return
		setSending(true)
		val started = webBridge?.send(type, text, context.key) { deliveryStatus, error ->
			runOnUiThread {
				setSending(false)
				val decision = nativePromptDeliveryDecision(type, deliveryStatus)
				if (decision.clearDraft) {
					drafts.remove(context.key)
					if (activeContext?.key == context.key && composerInput?.text?.toString() == text) composerInput?.text?.clear()
					composerStatus?.visibility = View.GONE
				}
				when (decision.feedback) {
					NativePromptFeedback.NONE -> Unit
					NativePromptFeedback.INSERT_UNCONFIRMED -> {
						composerStatus?.setTextColor(color(R.color.warning))
						composerStatus?.setText(R.string.inserted_draft_kept)
						composerStatus?.visibility = View.VISIBLE
					}
					NativePromptFeedback.SUBMIT_UNCONFIRMED -> {
						composerStatus?.setTextColor(color(R.color.warning))
						composerStatus?.setText(R.string.prompt_may_have_sent)
						composerStatus?.visibility = View.VISIBLE
					}
					NativePromptFeedback.NOT_DELIVERED -> {
						composerStatus?.setTextColor(color(R.color.danger))
						composerStatus?.text = getString(R.string.delivery_failed, error ?: getString(R.string.no_terminal))
						composerStatus?.visibility = View.VISIBLE
					}
				}
			}
		} ?: false
		if (!started) {
			setSending(false)
			composerStatus?.setText(R.string.no_terminal)
			composerStatus?.visibility = View.VISIBLE
		}
	}

	private fun setSending(sending: Boolean) {
		this.sending = sending
		val enabled = !sending && !composerInput?.text.isNullOrBlank()
		insertButton?.isEnabled = enabled
		sendButton?.isEnabled = enabled
		sendButton?.setText(if (sending) R.string.sending else R.string.send)
	}

	private fun textView(textId: Int, size: Float, colorId: Int): TextView = TextView(this).apply {
		if (textId != 0) setText(textId)
		textSize = size
		setTextColor(color(colorId))
	}

	private fun matchWrap(top: Int = 0): LinearLayout.LayoutParams {
		return LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
			topMargin = dp(top)
		}
	}

	private fun color(id: Int): Int = ContextCompat.getColor(this, id)
	private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
