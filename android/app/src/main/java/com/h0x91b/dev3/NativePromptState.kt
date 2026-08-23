package com.h0x91b.dev3

internal class NativePromptDrafts {
	private val values = linkedMapOf<String, String>()

	fun get(contextKey: String): String = values[contextKey].orEmpty()

	fun put(contextKey: String, text: String) {
		values[contextKey] = text
	}

	fun remove(contextKey: String) {
		values.remove(contextKey)
	}

	fun restore(entries: Map<String, String>) {
		values.putAll(entries)
	}

	fun snapshot(maxChars: Int): Map<String, String> {
		if (maxChars <= 0) return emptyMap()
		var remaining = maxChars
		val snapshot = linkedMapOf<String, String>()
		for ((key, value) in values) {
			if (remaining <= 0) break
			var end = minOf(value.length, remaining)
			if (
				end in 1 until value.length &&
				Character.isHighSurrogate(value[end - 1]) &&
				Character.isLowSurrogate(value[end])
			) {
				end -= 1
			}
			val bounded = value.substring(0, end)
			snapshot[key] = bounded
			remaining -= bounded.length
		}
		return snapshot
	}
}

internal enum class NativePromptFeedback {
	NONE,
	INSERT_UNCONFIRMED,
	SUBMIT_UNCONFIRMED,
	NOT_DELIVERED,
}

internal data class NativePromptDeliveryDecision(
	val clearDraft: Boolean,
	val feedback: NativePromptFeedback,
)

internal fun nativePromptDeliveryDecision(type: String, deliveryStatus: String): NativePromptDeliveryDecision {
	if (type == "submit" && deliveryStatus == "delivered") {
		return NativePromptDeliveryDecision(clearDraft = true, feedback = NativePromptFeedback.NONE)
	}
	if (deliveryStatus == "unconfirmed") {
		return NativePromptDeliveryDecision(
			clearDraft = false,
			feedback = if (type == "insert") NativePromptFeedback.INSERT_UNCONFIRMED else NativePromptFeedback.SUBMIT_UNCONFIRMED,
		)
	}
	return NativePromptDeliveryDecision(clearDraft = false, feedback = NativePromptFeedback.NOT_DELIVERED)
}
