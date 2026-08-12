package vn.pickpack1291.baohang.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BusinessRulesTest {
    @Test fun onlyAvailableAndSkipRequirePickerAcknowledgement() {
        assertTrue(IssueStatus.AVAILABLE.criticalForPicker)
        assertTrue(IssueStatus.SKIP_ALLOWED.criticalForPicker)
        assertFalse(IssueStatus.OPEN.criticalForPicker)
        assertFalse(IssueStatus.SEARCHING.criticalForPicker)
        assertFalse(IssueStatus.REPLENISHING.criticalForPicker)
    }

    @Test fun roleAliasesRemainBackwardCompatibleWithoutCreatingAdmin() {
        assertEquals(UserRole.PICKER, UserRole.from("UNKNOWN"))
        assertEquals(UserRole.ADMIN_INVENT, UserRole.from("invent_admin"))
        assertEquals(UserRole.INVENT, UserRole.from("invent_user"))
        assertEquals(UserRole.ADMIN, UserRole.from("ADMIN"))
    }

    @Test fun normalizedSearchSupportsContainsAndVietnameseAccents() {
        assertEquals("abcde coca cola", AppDatabase.normalize(" AbCDe  Côca Còla "))
    }
}
