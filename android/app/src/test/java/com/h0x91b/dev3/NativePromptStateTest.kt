package com.h0x91b.dev3

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativePromptStateTest {
	@Test
	fun keepsDraftsIsolatedByTerminalContext() {
		val drafts = NativePromptDrafts()
		drafts.put("task:project-1:task-1", "first task")
		drafts.put("task:project-1:task-2", "second task")
		drafts.put("project:project-1", "project shell")

		assertEquals("first task", drafts.get("task:project-1:task-1"))
		assertEquals("second task", drafts.get("task:project-1:task-2"))
		assertEquals("project shell", drafts.get("project:project-1"))
	}

	@Test
	fun boundsTheSavedStateSnapshotWithoutMutatingLiveDrafts() {
		val drafts = NativePromptDrafts()
		drafts.put("task:a", "12345")
		drafts.put("task:b", "67890")

		assertEquals(mapOf("task:a" to "12345", "task:b" to "678"), drafts.snapshot(8))
		assertEquals("67890", drafts.get("task:b"))
	}

	@Test
	fun restoresWholeUnicodeDrafts() {
		val drafts = NativePromptDrafts()
		val prompt = "请检查这个改动，并保留输入法组合文本 🚀"
		drafts.restore(mapOf("task:project:task" to prompt))

		assertEquals(prompt, drafts.get("task:project:task"))
	}

	@Test
	fun neverSplitsASurrogatePairAtTheSnapshotLimit() {
		val drafts = NativePromptDrafts()
		drafts.put("task:a", "a🚀b")

		assertEquals(mapOf("task:a" to "a"), drafts.snapshot(2))
		assertEquals(mapOf("task:a" to "a🚀"), drafts.snapshot(3))
	}

	@Test
	fun clearsOnlyAConfirmedTaskSubmit() {
		val delivered = nativePromptDeliveryDecision("submit", "delivered")
		assertTrue(delivered.clearDraft)
		assertEquals(NativePromptFeedback.NONE, delivered.feedback)

		for (status in listOf("unconfirmed", "not-delivered")) {
			assertFalse(nativePromptDeliveryDecision("submit", status).clearDraft)
		}
		assertFalse(nativePromptDeliveryDecision("insert", "delivered").clearDraft)
	}

	@Test
	fun distinguishesAmbiguousInsertAndSubmitFeedback() {
		assertEquals(
			NativePromptFeedback.INSERT_UNCONFIRMED,
			nativePromptDeliveryDecision("insert", "unconfirmed").feedback,
		)
		assertEquals(
			NativePromptFeedback.SUBMIT_UNCONFIRMED,
			nativePromptDeliveryDecision("submit", "unconfirmed").feedback,
		)
		assertEquals(
			NativePromptFeedback.NOT_DELIVERED,
			nativePromptDeliveryDecision("submit", "not-delivered").feedback,
		)
	}
}
