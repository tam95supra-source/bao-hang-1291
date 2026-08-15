# Firestore Rules tests

This harness validates Báo hàng 1291 emergency Firestore Security Rules against the local Firebase Emulator only. It uses a `demo-*` project ID and must not write to production resources.

The suite covers unauthenticated and wrong-site denial, Picker emergency-report writes and device binding, Invent operational reads, Sheet Drain boundaries, and the global deny-by-default rule.

The CI gate must pass on a trusted branch commit before the same ruleset is published to Firebase.
