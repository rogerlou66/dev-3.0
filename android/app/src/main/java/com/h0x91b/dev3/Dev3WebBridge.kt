package com.h0x91b.dev3

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

data class TerminalContext(
	val kind: String,
	val projectId: String,
	val taskId: String?,
	val rawMode: Boolean,
) {
	val key: String = if (taskId == null) "project:$projectId" else "task:$projectId:$taskId"
}

class Dev3WebBridge(
	private val allowedOrigin: String,
	private val onTerminalContext: (TerminalContext?) -> Unit,
	private val onAuthFailed: () -> Unit,
	private val onConnectionState: (String) -> Unit,
	private val onBackOutcome: (String) -> Unit,
	private val onAppendDraft: (String, String) -> Unit,
	private val onBridgeReady: (Int) -> Unit,
	private val onDeviceRequest: (JSONObject) -> Unit,
	private val isTrustedMainFrame: () -> Boolean,
	private val onLogoutResult: () -> Unit,
) {
	private data class PendingCommand(
		val callback: (String, String?) -> Unit,
		val timeout: Runnable,
	)

	private var replyProxy: JavaScriptReplyProxy? = null
	private val requestSequence = AtomicLong()
	private val pending = mutableMapOf<String, PendingCommand>()
	private val handler = Handler(Looper.getMainLooper())

	fun attach(webView: WebView) {
		WebViewCompat.addWebMessageListener(
			webView,
			"dev3Android",
			setOf(allowedOrigin),
		) { _, message, sourceOrigin, isMainFrame, proxy ->
			if (!isMainFrame || sourceOrigin.toString() != allowedOrigin || !isTrustedMainFrame()) return@addWebMessageListener
			replyProxy = proxy
			handle(message)
		}
	}

	fun send(type: String, text: String, contextKey: String, callback: (String, String?) -> Unit): Boolean {
		val proxy = replyProxy ?: return false
		val requestId = requestSequence.incrementAndGet().toString()
		val timeout = Runnable {
			pending.remove(requestId)?.callback?.invoke("unconfirmed", "Request timed out")
		}
		pending[requestId] = PendingCommand(callback, timeout)
		handler.postDelayed(timeout, 30_000)
		return try {
			proxy.postMessage(
				JSONObject()
					.put("type", type)
					.put("requestId", requestId)
					.put("contextKey", contextKey)
					.put("text", text)
					.toString(),
			)
			true
		} catch (error: Exception) {
			handler.removeCallbacks(timeout)
			pending.remove(requestId)
			callback("not-delivered", error.message ?: "Bridge write failed")
			false
		}
	}

	fun detach() {
		replyProxy = null
		failPending("Connection closed")
		onTerminalContext(null)
	}

	fun postToPage(payload: JSONObject): Boolean {
		val proxy = replyProxy ?: return false
		return try {
			proxy.postMessage(payload.toString())
			true
		} catch (_: Exception) {
			false
		}
	}

	fun postDeviceResult(requestId: String, ok: Boolean, payload: JSONObject? = null, error: String? = null) {
		val result = JSONObject()
			.put("type", "device-result")
			.put("requestId", requestId)
			.put("ok", ok)
		if (payload != null) result.put("payload", payload)
		if (error != null) result.put("error", error)
		postToPage(result)
	}

	private fun handle(message: WebMessageCompat) {
		val body = runCatching { JSONObject(message.data ?: return) }.getOrNull() ?: return
		when (body.optString("type")) {
			"bridge-ready" -> {
				failPending("Page reloaded")
				onBridgeReady(body.optInt("version", 0))
			}
			"device-request" -> onDeviceRequest(body)
			"logout-result" -> onLogoutResult()
			"terminal-context" -> onTerminalContext(parseContext(body.optJSONObject("context")))
			"auth-failed" -> onAuthFailed()
			"connection-state" -> body.optString("state").takeIf { it.isNotBlank() }?.let(onConnectionState)
			"back-outcome" -> body.optString("outcome").takeIf { it.isNotBlank() }?.let(onBackOutcome)
			"append-draft" -> {
				val contextKey = body.optString("contextKey")
				val text = body.optString("text")
				if (contextKey.isNotBlank() && text.isNotEmpty()) onAppendDraft(contextKey, text)
			}
			"command-result" -> {
				val requestId = body.optString("requestId")
				val command = pending.remove(requestId) ?: return
				handler.removeCallbacks(command.timeout)
				val fallbackStatus = if (body.optBoolean("ok")) "delivered" else "unconfirmed"
				command.callback(body.optString("deliveryStatus", fallbackStatus), body.optString("error").ifBlank { null })
			}
		}
	}

	private fun failPending(reason: String) {
		val outstanding = pending.values.toList()
		pending.clear()
		outstanding.forEach {
			handler.removeCallbacks(it.timeout)
			it.callback("unconfirmed", reason)
		}
	}

	private fun parseContext(body: JSONObject?): TerminalContext? {
		body ?: return null
		val kind = body.optString("kind")
		val projectId = body.optString("projectId")
		if ((kind != "task" && kind != "project") || projectId.isBlank()) return null
		return TerminalContext(
			kind = kind,
			projectId = projectId,
			taskId = body.optString("taskId").ifBlank { null },
			rawMode = body.optBoolean("rawMode"),
		)
	}
}
