---
name: feedback-no-overclaim
description: Line catches overconfident claims; state the evidence level of every claim (verified on this machine vs one source vs guess)
metadata:
  node_type: memory
  type: feedback
  originSessionId: 0bf35df1-8e96-432f-8845-c9f2d92cf9cd
  modified: 2026-10-13T19:10:36.171Z
---

On 2026-10-14 I told Line "Windows will do this anyway" (auto-run SecureBootRecovery / install the 2023 certs) based on one UEFI.org slide, while my own test on Line's machine had shown Windows does NOT service Secure Boot certs when Secure Boot is disabled. Line made a decision on that claim, then caught the contradiction ("vậy sao nãy bạn đảm bảo window sẽ thay"). Same pattern as the September BIOS-update advice and the earlier CA-2023 hypothesis.

**Why:** Line acts on what I say about their machine (BIOS, Secure Boot, drivers); an overstated claim costs real money or time, and the laptop is out of warranty.
**How to apply:** label each machine-affecting claim: "đã kiểm tra trên máy Line" / "theo một nguồn, chưa kiểm" / "tôi đoán". Never present a single third-party source as what will happen, and check a new claim against facts already verified in the session before saying it. Related: [[harness-reliability-2026-10-12]].
