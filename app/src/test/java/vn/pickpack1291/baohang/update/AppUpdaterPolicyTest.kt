package vn.pickpack1291.baohang.update

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdaterPolicyTest {
    @Test fun autoCheckRunsImmediatelyAndThenEveryFiveMinutes() {
        val now = 1_000_000L
        assertTrue(AppUpdater.shouldAutoCheck(now, 0L))
        assertFalse(AppUpdater.shouldAutoCheck(now, now - AppUpdater.AUTO_CHECK_INTERVAL_MS + 1L))
        assertTrue(AppUpdater.shouldAutoCheck(now, now - AppUpdater.AUTO_CHECK_INTERVAL_MS))
    }

    @Test fun acceptsDirectGithubApkForMatchingChannel() {
        assertTrue(
            AppUpdater.isTrustedGitHubApkUrl(
                "https://github.com/tam95supra-source/bao-hang-1291/releases/download/beta-v1.6.18/bao-hang-1291-beta-1.6.18.apk",
                "beta"
            )
        )
        assertTrue(
            AppUpdater.isTrustedGitHubApkUrl(
                "https://github.com/tam95supra-source/bao-hang-1291/releases/download/stable-v1.6.5/bao-hang-1291-stable-1.6.5.apk",
                "stable"
            )
        )
    }

    @Test fun rejectsWrongHostChannelOrNonApk() {
        assertFalse(
            AppUpdater.isTrustedGitHubApkUrl(
                "https://example.com/tam95supra-source/bao-hang-1291/releases/download/beta-v1.6.18/app.apk",
                "beta"
            )
        )
        assertFalse(
            AppUpdater.isTrustedGitHubApkUrl(
                "https://github.com/tam95supra-source/bao-hang-1291/releases/download/stable-v1.6.5/bao-hang-1291-stable-1.6.5.apk",
                "beta"
            )
        )
        assertFalse(
            AppUpdater.isTrustedGitHubApkUrl(
                "https://github.com/tam95supra-source/bao-hang-1291/releases/download/beta-v1.6.18/release-manifest.json",
                "beta"
            )
        )
    }
}
