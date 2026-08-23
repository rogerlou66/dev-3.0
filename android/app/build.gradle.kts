plugins {
	id("com.android.application")
}

android {
	namespace = "com.h0x91b.dev3"
	compileSdk = 37

	defaultConfig {
		applicationId = "com.h0x91b.dev3"
		minSdk = 26
		targetSdk = 37
		versionCode = 1
		versionName = "0.1.0"
		testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
	}

	buildTypes {
		release {
			isMinifyEnabled = false
		}
	}

	compileOptions {
		sourceCompatibility = JavaVersion.VERSION_17
		targetCompatibility = JavaVersion.VERSION_17
	}

	testOptions {
		unitTests.isIncludeAndroidResources = true
	}
}

dependencies {
	implementation("androidx.activity:activity-ktx:1.13.0")
	implementation("androidx.fragment:fragment:1.9.0")
	implementation("androidx.webkit:webkit:1.17.0")
	implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
	testImplementation("junit:junit:4.13.2")
	testImplementation("org.robolectric:robolectric:4.16.1")
	androidTestImplementation("androidx.test:core-ktx:1.7.0")
	androidTestImplementation("androidx.test.ext:junit:1.3.0")
	androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
	androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}

tasks.withType<org.gradle.api.tasks.testing.Test>().configureEach {
	val testHome = layout.buildDirectory.dir("test-user-home")
	systemProperty("user.home", testHome.get().asFile.absolutePath)
	doFirst { testHome.get().asFile.mkdirs() }
}
