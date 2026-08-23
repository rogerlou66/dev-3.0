package com.h0x91b.dev3

import java.net.URI
import java.util.Locale

data class ConnectionTarget(
	val initialUrl: String,
	val origin: String,
	val storedUrl: String,
	val unsafeCleartext: Boolean,
)

class ConnectionUrlException(val reason: Reason) : IllegalArgumentException() {
	enum class Reason { INVALID, PUBLIC_CLEARTEXT }
}

object ConnectionUrl {
	fun parse(raw: String): ConnectionTarget {
		val uri = runCatching { URI(raw.trim()) }.getOrNull()
			?: throw ConnectionUrlException(ConnectionUrlException.Reason.INVALID)
		val scheme = uri.scheme?.lowercase(Locale.US)
		val host = uri.host?.lowercase(Locale.US)?.removePrefix("[")?.removeSuffix("]")
		val path = uri.path.orEmpty()
		if (
			(scheme != "http" && scheme != "https") || host.isNullOrBlank() || uri.userInfo != null ||
			(path.isNotEmpty() && path != "/" && path != "/index.html")
		) {
			throw ConnectionUrlException(ConnectionUrlException.Reason.INVALID)
		}
		if (scheme == "http" && !isPrivateHost(host)) {
			throw ConnectionUrlException(ConnectionUrlException.Reason.PUBLIC_CLEARTEXT)
		}

		val authority = if (uri.port == -1) formatHost(host) else "${formatHost(host)}:${uri.port}"
		val origin = "$scheme://$authority"
		return ConnectionTarget(
			initialUrl = uri.toASCIIString(),
			origin = origin,
			storedUrl = "$origin/",
			unsafeCleartext = scheme == "http" && !isProtectedCleartextHost(host),
		)
	}

	private fun formatHost(host: String): String = if (host.contains(":")) "[$host]" else host

	private fun isPrivateHost(host: String): Boolean {
		if (
			host == "localhost" || host.endsWith(".local") || host == "::1" ||
			(host.contains(":") && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")))
		) return true
		val octets = host.split(".").mapNotNull { it.toIntOrNull() }
		if (octets.size != 4 || octets.any { it !in 0..255 }) return false
		return octets[0] == 10 ||
			(octets[0] == 172 && octets[1] in 16..31) ||
			(octets[0] == 192 && octets[1] == 168) ||
			(octets[0] == 100 && octets[1] in 64..127) ||
			octets[0] == 127 ||
			(octets[0] == 169 && octets[1] == 254)
	}

	private fun isProtectedCleartextHost(host: String): Boolean {
		if (host == "localhost" || host == "::1") return true
		if (host.startsWith("fd7a:115c:a1e0:")) return true
		val octets = host.split(".").mapNotNull { it.toIntOrNull() }
		if (octets.size != 4) return false
		return octets[0] == 127 || (octets[0] == 100 && octets[1] in 64..127)
	}
}
