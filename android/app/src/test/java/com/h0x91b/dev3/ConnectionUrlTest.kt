package com.h0x91b.dev3

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ConnectionUrlTest {
	@Test
	fun keepsTheOneTimeTokenOnlyInTheInitialUrl() {
		val target = ConnectionUrl.parse("http://192.168.1.20:3017/?token=secret")
		assertEquals("http://192.168.1.20:3017/?token=secret", target.initialUrl)
		assertEquals("http://192.168.1.20:3017", target.origin)
		assertEquals("http://192.168.1.20:3017/", target.storedUrl)
		assertEquals(true, target.unsafeCleartext)
	}

	@Test
	fun acceptsHttpsAndTailscaleCleartextAddresses() {
		assertEquals("https://example.com", ConnectionUrl.parse("https://example.com/?token=x").origin)
		assertEquals(false, ConnectionUrl.parse("http://100.100.1.2:3017/").unsafeCleartext)
		assertEquals(false, ConnectionUrl.parse("http://[fd7a:115c:a1e0::1]:3017/").unsafeCleartext)
	}

	@Test
	fun rejectsPublicCleartextAndCredentials() {
		val publicHttp = assertThrows(ConnectionUrlException::class.java) {
			ConnectionUrl.parse("http://example.com/?token=x")
		}
		assertEquals(ConnectionUrlException.Reason.PUBLIC_CLEARTEXT, publicHttp.reason)
		assertThrows(ConnectionUrlException::class.java) {
			ConnectionUrl.parse("https://user:pass@example.com/")
		}
		assertThrows(ConnectionUrlException::class.java) {
			ConnectionUrl.parse("https://example.com/p/3000/")
		}
		val prefixedHostname = assertThrows(ConnectionUrlException::class.java) {
			ConnectionUrl.parse("http://fd-example.com/")
		}
		assertEquals(ConnectionUrlException.Reason.PUBLIC_CLEARTEXT, prefixedHostname.reason)
	}
}
