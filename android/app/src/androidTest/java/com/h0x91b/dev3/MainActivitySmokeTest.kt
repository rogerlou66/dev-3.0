package com.h0x91b.dev3

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.os.SystemClock
import android.util.Log
import android.util.Base64
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeNotNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MainActivitySmokeTest {
	@Test
	fun launcherShowsAUsableConnectionOrWorkspaceSurface() {
		val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
		device.wakeUp()
		device.pressHome()
		device.executeShellCommand("monkey -p $TARGET_PACKAGE -c android.intent.category.LAUNCHER 1")

		assertTrue(device.wait(Until.hasObject(By.pkg(TARGET_PACKAGE).depth(0)), LAUNCH_TIMEOUT_MS))
		device.waitForIdle()

		val connectionTitle = device.findObject(By.text("Connect to your computer"))
		if (connectionTitle != null) {
			val scan = device.findObject(By.text("Scan QR code"))
			val connect = device.findObject(By.text("Connect"))
			assertNotNull(scan)
			assertNotNull(connect)
			assertTrue(scan.isClickable)
			assertTrue(connect.isClickable)
			return
		}

		assertNotNull(device.findObject(By.text("Connected computer")))
		val nativePrompt = device.findObject(By.text("Prompt to coding agent"))
		if (nativePrompt != null) {
			val send = device.findObject(By.text("Send"))
			assertNotNull(send)
			assertTrue(send.isClickable)
		}
	}

	@Test
	fun nativePromptAcceptsALargeUnicodeDraftQuickly() {
		val device = launchTarget()
		val input = device.wait(Until.findObject(By.hint("Type a multiline prompt")), PROMPT_TIMEOUT_MS)
		assumeNotNull(input)
		val promptInput = requireNotNull(input)
		val prompt = "请检查 Android 原生输入是否流畅，不要发送。🚀\n".repeat(256)

		val startedAt = SystemClock.elapsedRealtimeNanos()
		promptInput.text = prompt
		val elapsedMs = (SystemClock.elapsedRealtimeNanos() - startedAt) / 1_000_000

		assertEquals(prompt, promptInput.text)
		assertTrue("Large native prompt took ${elapsedMs}ms", elapsedMs < MAX_PROMPT_SET_TEXT_MS)
		val send = device.findObject(By.text("Send"))
		assertNotNull(send)
		assertTrue(send.isEnabled)
		Log.i("Dev3PromptPerf", "setTextMs=$elapsedMs chars=${prompt.length}")
		promptInput.text = ""
	}

	@Test
	fun nativePromptDeliversToALiveAgentWhenExplicitlyEnabled() {
		val arguments = InstrumentationRegistry.getArguments()
		assumeTrue(arguments.getString("delivery_probe") == "true")
		val prompt = String(
			Base64.decode(requireNotNull(arguments.getString("prompt_b64")), Base64.NO_WRAP),
			Charsets.UTF_8,
		)
		val device = launchTarget()
		val input = requireNotNull(device.wait(Until.findObject(By.hint("Type a multiline prompt")), PROMPT_TIMEOUT_MS))
		input.text = prompt
		assertEquals(prompt, input.text)
		val send = requireNotNull(device.findObject(By.text("Send")))
		assertTrue(send.isEnabled)

		val startedAt = SystemClock.elapsedRealtime()
		send.click()
		while (SystemClock.elapsedRealtime() - startedAt < DELIVERY_TIMEOUT_MS && input.text == prompt) {
			SystemClock.sleep(50)
		}
		val elapsedMs = SystemClock.elapsedRealtime() - startedAt
		assertTrue(
			"Confirmed delivery must clear the native draft",
			input.text.isEmpty() || input.text == "Type a multiline prompt",
		)
		Log.i("Dev3PromptPerf", "deliveryMs=$elapsedMs chars=${prompt.length}")
	}

	private fun launchTarget(): UiDevice {
		val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
		device.wakeUp()
		device.pressHome()
		device.executeShellCommand("monkey -p $TARGET_PACKAGE -c android.intent.category.LAUNCHER 1")
		assertTrue(device.wait(Until.hasObject(By.pkg(TARGET_PACKAGE).depth(0)), LAUNCH_TIMEOUT_MS))
		device.waitForIdle()
		return device
	}

	companion object {
		private const val TARGET_PACKAGE = "com.h0x91b.dev3"
		private const val LAUNCH_TIMEOUT_MS = 15_000L
		private const val PROMPT_TIMEOUT_MS = 10_000L
		private const val MAX_PROMPT_SET_TEXT_MS = 1_000L
		private const val DELIVERY_TIMEOUT_MS = 35_000L
	}
}
