package com.h0x91b.dev3

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class RemoteDownloadUrlTest {
	private val token = "a".repeat(43)

	@Test
	fun resolvesOnlyThePairedOriginArtifactRoute() {
		assertEquals(
			"https://dev3.example.com/api/artifact-download/$token",
			resolveArtifactDownloadUrl("https://dev3.example.com", "/api/artifact-download/$token"),
		)
		assertEquals(
			"http://192.168.1.20:3017/api/artifact-download/$token",
			resolveArtifactDownloadUrl("http://192.168.1.20:3017", "/api/artifact-download/$token"),
		)
	}

	@Test
	fun rejectsCrossOriginCredentialsQueriesAndTraversal() {
		for (url in listOf(
			"https://evil.example.com/api/artifact-download/$token",
			"//evil.example.com/api/artifact-download/$token",
			"https://user:pass@dev3.example.com/api/artifact-download/$token",
			"/api/artifact-download/$token?next=evil",
			"/api/artifact-download/../$token",
			"/api/artifact-download/short",
		)) {
			assertThrows(IllegalArgumentException::class.java) {
				resolveArtifactDownloadUrl("https://dev3.example.com", url)
			}
		}
	}

	@Test
	fun streamsExactBytesWithoutBuildingABase64Envelope() {
		val bytes = ByteArray(2 * 1024 * 1024 + 7) { (it % 251).toByte() }
		val output = ByteArrayOutputStream()

		assertEquals(
			bytes.size.toLong(),
			copyExactRemoteFile(ByteArrayInputStream(bytes), output, bytes.size.toLong(), 4L * 1024 * 1024),
		)
		assertEquals(bytes.asList(), output.toByteArray().asList())
	}

	@Test
	fun rejectsTruncatedAndOversizedStreams() {
		assertThrows(IllegalStateException::class.java) {
			copyExactRemoteFile(ByteArrayInputStream(byteArrayOf(1, 2)), ByteArrayOutputStream(), 3, 4)
		}
		assertThrows(IllegalStateException::class.java) {
			copyExactRemoteFile(ByteArrayInputStream(byteArrayOf(1, 2, 3, 4, 5)), ByteArrayOutputStream(), 4, 4)
		}
	}
}
