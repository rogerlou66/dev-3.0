package com.h0x91b.dev3

import android.content.Context
import android.os.Looper
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MainActivityRobolectricTest {
	@Before
	fun clearSavedState() {
		val app = RuntimeEnvironment.getApplication()
		app.getSharedPreferences("dev3-connection", Context.MODE_PRIVATE).edit().clear().commit()
		app.getSharedPreferences("dev3-device", Context.MODE_PRIVATE).edit().clear().commit()
	}

	@Test
	fun firstLaunchOffersBothConnectionPaths() {
		val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
		val views = descendants(activity.findViewById(android.R.id.content))

		assertTrue(views.filterIsInstance<TextView>().any { it.text == activity.getString(R.string.connect_title) })
		assertTrue(views.filterIsInstance<Button>().any { it.text == activity.getString(R.string.scan_qr) && it.isClickable })
		assertTrue(views.filterIsInstance<Button>().any { it.text == activity.getString(R.string.connect) && it.isClickable })
	}

	@Test
	fun publicCleartextLinkIsRejectedBeforeCreatingAWebView() {
		val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
		val root = activity.findViewById<View>(android.R.id.content)
		val input = descendants(root).filterIsInstance<EditText>().single()
		val connect = descendants(root).filterIsInstance<Button>().single { it.text == activity.getString(R.string.connect) }

		input.setText("http://example.com/?token=secret")
		connect.performClick()

		assertTrue(
			descendants(root).filterIsInstance<TextView>()
				.any { it.text == activity.getString(R.string.public_http_blocked) && it.visibility == View.VISIBLE },
		)
		assertNotNull(activity.findViewById<View>(android.R.id.content))
	}

	@Test
	fun privateLanCleartextRendersAnExplicitSecondStep() {
		val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
		val root = activity.findViewById<View>(android.R.id.content)
		val showUnsafe = MainActivity::class.java.getDeclaredMethod("showUnsafeConnection", ConnectionTarget::class.java)
		showUnsafe.isAccessible = true
		showUnsafe.invoke(activity, ConnectionUrl.parse("http://192.168.1.20:3017/?token=secret"))
		shadowOf(Looper.getMainLooper()).idle()

		val buttons = descendants(root).filterIsInstance<Button>()
		assertTrue(buttons.any { it.text == activity.getString(R.string.go_back) && it.isClickable })
		assertTrue(buttons.any { it.text == activity.getString(R.string.connect_anyway) && it.isClickable })
		assertTrue(
			descendants(root).filterIsInstance<TextView>()
				.any { it.text == activity.getString(R.string.unsafe_connection_title) },
		)
	}

	@Test
	fun nativeUnicodePromptSurvivesActivityRecreation() {
		val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
		val activity = controller.get()
		val context = TerminalContext("task", "project-1", "task-1", rawMode = false)
		val (_, input) = attachComposer(activity, context)
		val prompt = "请检查这个改动，并保留输入法组合文本 🚀"
		input.setText(prompt)

		val savedState = Bundle()
		controller.saveInstanceState(savedState).pause().stop().destroy()
		val restoredController = Robolectric.buildActivity(MainActivity::class.java)
			.create(savedState)
			.start()
			.resume()
			.visible()
		val (_, restoredInput) = attachComposer(restoredController.get(), context)

		assertTrue(restoredInput.text.toString() == prompt)
	}

	@Test
	fun nativePromptDraftsFollowTheSelectedTask() {
		val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
		val first = TerminalContext("task", "project-1", "task-1", rawMode = false)
		val second = TerminalContext("task", "project-1", "task-2", rawMode = false)
		val (_, input) = attachComposer(activity, first)
		input.setText("first task draft")

		showContext(activity, second)
		input.setText("second task draft")
		showContext(activity, first)

		assertTrue(input.text.toString() == "first task draft")
	}

	@Test
	fun connectedHostChromeIsACompactOverlayInsteadOfAFullWidthRow() {
		val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
		val parent = FrameLayout(activity)
		invoke(activity, "createHostMenuButton", arrayOf(FrameLayout::class.java), parent)

		val button = descendants(parent).filterIsInstance<Button>().single { it.tag == "android-host-menu" }
		val layout = button.layoutParams as FrameLayout.LayoutParams
		assertEquals(dp(activity, 48), layout.width)
		assertEquals(dp(activity, 48), layout.height)
		assertTrue(button.contentDescription.contains(activity.getString(R.string.connected_computer)))
		assertTrue(descendants(parent).filterIsInstance<TextView>().none { it.text == activity.getString(R.string.connected_computer) })
	}

	@Test
	fun narrowSafeConnectionUsesTheSharedMoreSheetButWarningsKeepNativeRecoveryVisible() {
		val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
		activity.resources.configuration.screenWidthDp = 390
		val parent = FrameLayout(activity)
		invoke(activity, "createHostMenuButton", arrayOf(FrameLayout::class.java), parent)
		val button = descendants(parent).filterIsInstance<Button>().single { it.tag == "android-host-menu" }
		setField(activity, "bridgeReady", true)
		setField(activity, "currentTarget", ConnectionUrl.parse("https://example.com"))
		invoke(activity, "refreshHostMenuButton")
		assertEquals(View.GONE, button.visibility)

		setField(activity, "currentTarget", ConnectionUrl.parse("http://192.168.1.20:3017"))
		invoke(activity, "setHostStatus", arrayOf(Int::class.javaPrimitiveType!!), R.string.connected_unencrypted)
		assertEquals(View.VISIBLE, button.visibility)
		assertTrue(button.contentDescription.contains(activity.getString(R.string.connected_unencrypted)))
	}

	@Test
	fun bridgeSwitchComputerActionClearsTheSavedHostAndReturnsToPairing() {
		val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
		ConnectionStore(activity).save("https://example.com/")
		invoke(
			activity,
			"onDeviceRequest",
			arrayOf(JSONObject::class.java),
			JSONObject().put("type", "device-request").put("requestId", "switch-1").put("action", "switch-computer"),
		)
		shadowOf(Looper.getMainLooper()).idle()

		assertEquals(null, ConnectionStore(activity).load())
		assertTrue(descendants(activity.findViewById(android.R.id.content)).filterIsInstance<TextView>()
			.any { it.text == activity.getString(R.string.connect_title) })
	}

	private fun attachComposer(activity: MainActivity, context: TerminalContext): Pair<LinearLayout, EditText> {
		val parent = LinearLayout(activity)
		val createComposer = MainActivity::class.java.getDeclaredMethod("createComposer", ViewGroup::class.java)
		createComposer.isAccessible = true
		createComposer.invoke(activity, parent)
		showContext(activity, context)
		val input = descendants(parent).filterIsInstance<EditText>().single()
		return parent to input
	}

	private fun showContext(activity: MainActivity, context: TerminalContext) {
		val onTerminalContext = MainActivity::class.java.getDeclaredMethod("onTerminalContext", TerminalContext::class.java)
		onTerminalContext.isAccessible = true
		onTerminalContext.invoke(activity, context)
		shadowOf(Looper.getMainLooper()).idle()
	}

	private fun invoke(activity: MainActivity, name: String, parameterTypes: Array<Class<*>> = emptyArray(), vararg args: Any) {
		val method = MainActivity::class.java.getDeclaredMethod(name, *parameterTypes)
		method.isAccessible = true
		method.invoke(activity, *args)
	}

	private fun setField(activity: MainActivity, name: String, value: Any) {
		val field = MainActivity::class.java.getDeclaredField(name)
		field.isAccessible = true
		field.set(activity, value)
	}

	private fun dp(activity: MainActivity, value: Int): Int = (value * activity.resources.displayMetrics.density).toInt()

	private fun descendants(root: View): List<View> {
		val result = mutableListOf<View>()
		fun visit(view: View) {
			result += view
			if (view is ViewGroup) {
				for (index in 0 until view.childCount) visit(view.getChildAt(index))
			}
		}
		visit(root)
		return result
	}
}
