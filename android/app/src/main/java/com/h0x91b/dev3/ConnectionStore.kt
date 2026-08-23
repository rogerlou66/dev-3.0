package com.h0x91b.dev3

import android.content.Context

class ConnectionStore(context: Context) {
	private val preferences = context.getSharedPreferences("dev3-connection", Context.MODE_PRIVATE)

	fun load(): String? = preferences.getString("last-origin", null)

	fun save(url: String) {
		preferences.edit().putString("last-origin", url).apply()
	}

	fun clear() {
		preferences.edit().clear().apply()
	}
}
