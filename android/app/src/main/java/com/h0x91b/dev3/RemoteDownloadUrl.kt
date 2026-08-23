package com.h0x91b.dev3

import java.net.URI
import java.util.Locale
import java.io.InputStream
import java.io.OutputStream

private val ARTIFACT_DOWNLOAD_PATH = Regex("^/api/artifact-download/[A-Za-z0-9_-]{43}$")

internal fun resolveArtifactDownloadUrl(origin: String, rawUrl: String): String {
	val base = runCatching { URI("${origin.trimEnd('/')}/") }.getOrNull()
		?: throw IllegalArgumentException("Invalid paired computer origin")
	val resolved = runCatching { base.resolve(rawUrl) }.getOrNull()
		?: throw IllegalArgumentException("Invalid artifact download URL")
	if (
		resolved.scheme?.lowercase(Locale.US) !in setOf("http", "https") ||
		resolved.userInfo != null || resolved.rawQuery != null || resolved.rawFragment != null ||
		originOf(resolved) != origin || !ARTIFACT_DOWNLOAD_PATH.matches(resolved.path.orEmpty())
	) {
		throw IllegalArgumentException("Artifact download URL is outside the paired computer")
	}
	return resolved.toASCIIString()
}

private fun originOf(uri: URI): String {
	val scheme = uri.scheme.lowercase(Locale.US)
	val host = uri.host.lowercase(Locale.US)
	val authorityHost = if (host.contains(':')) "[$host]" else host
	return if (uri.port == -1) "$scheme://$authorityHost" else "$scheme://$authorityHost:${uri.port}"
}

internal fun copyExactRemoteFile(
	input: InputStream,
	output: OutputStream,
	expectedBytes: Long,
	maxBytes: Long,
): Long {
	require(expectedBytes in 0..maxBytes) { "Invalid expected download size" }
	var written = 0L
	val buffer = ByteArray(64 * 1024)
	while (true) {
		val count = input.read(buffer)
		if (count < 0) break
		written += count
		if (written > maxBytes) error("Download exceeds the Android safety limit")
		output.write(buffer, 0, count)
	}
	if (written != expectedBytes) error("Download ended with an unexpected size")
	return written
}
