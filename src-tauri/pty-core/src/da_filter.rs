use crate::session::{DA1_REPLY, DA2_REPLY, DA_BUFFER_CAP};

// ─── State machine ────────────────────────────────────────────────────────────

/// DA filter internal state.
///
/// Transition table (per design §2.5):
///
/// | State     | Byte          | Next state | Action                                      |
/// |-----------|---------------|------------|---------------------------------------------|
/// | Idle      | ESC (0x1B)    | AfterEsc   | start buffering, do not yet emit ESC        |
/// | Idle      | other         | Idle       | emit byte to filtered output                |
/// | AfterEsc  | `[` (0x5B)    | InsideCsi  | continue buffering (ESC [ so far)           |
/// | AfterEsc  | other         | Idle       | flush buffered ESC + this byte to output    |
/// | InsideCsi | `c` (0x63)    | Idle       | DA query → queue reply, drop buffer         |
/// | InsideCsi | params 0x30-3F| InsideCsi  | continue buffering                          |
/// | InsideCsi | final ≠ `c`   | Idle       | flush full buffer to output (not a DA)      |
/// | InsideCsi | buf ≥ 256     | Idle       | overflow → flush buffer, reset state        |
#[derive(Debug, PartialEq)]
enum State {
    Idle,
    /// Saw ESC, next byte determines if this is a CSI.
    AfterEsc,
    /// Saw ESC `[`, accumulating parameter bytes.
    InsideCsi {
        /// True if `>` was seen as the first parameter byte (DA2 discriminator).
        is_da2: bool,
    },
}

/// 3-state machine that intercepts DA1 (`ESC [ c`) and DA2 (`ESC [ > c`) queries,
/// emits the canonical VT102 reply, and forwards all other bytes unchanged.
///
/// # Design references
/// - Design §2.5 — state transition table and buffer cap rationale.
/// - REQ-PTY-009 — DA1/DA2 interception requirement.
///
/// # Lock-ordering guarantee
/// `DaFilter` holds no locks itself. The caller (reader thread) must ensure:
/// - Replies are written to the PTY master writer BEFORE acquiring `pending`.
/// - `pending` is NEVER held while writing replies.
pub struct DaFilter {
    state: State,
    /// Accumulation buffer for the current (possibly incomplete) CSI sequence.
    /// Includes the leading ESC and `[` bytes so we can flush them intact if
    /// the sequence turns out not to be a DA query.
    buf: Vec<u8>,
}

impl DaFilter {
    /// Creates a new filter in the `Idle` state with an empty buffer.
    pub fn new() -> Self {
        Self {
            state: State::Idle,
            buf: Vec::new(),
        }
    }

    /// Processes an input slice.
    ///
    /// Returns `(filtered_bytes, replies)` where:
    /// - `filtered_bytes` — bytes to forward to the `pending` buffer (to the frontend).
    /// - `replies` — zero or more static byte slices to write to the PTY master writer.
    ///
    /// DA query bytes are NOT included in `filtered_bytes`.
    /// Replies reference `DA1_REPLY` / `DA2_REPLY` constants (`'static` — no allocation).
    pub fn process(&mut self, input: &[u8]) -> (Vec<u8>, Vec<&'static [u8]>) {
        let mut out = Vec::with_capacity(input.len());
        let mut replies: Vec<&'static [u8]> = Vec::new();

        for &byte in input {
            match self.state {
                State::Idle => {
                    if byte == 0x1B {
                        // Start buffering — we don't know yet if this is CSI.
                        self.buf.push(byte);
                        self.state = State::AfterEsc;
                    } else {
                        out.push(byte);
                    }
                }

                State::AfterEsc => {
                    if byte == 0x5B {
                        // ESC [ → enter CSI accumulation.
                        self.buf.push(byte);
                        self.state = State::InsideCsi { is_da2: false };
                    } else {
                        // Not a CSI — flush ESC + this byte to output.
                        out.extend_from_slice(&self.buf);
                        self.buf.clear();
                        out.push(byte);
                        self.state = State::Idle;
                    }
                }

                State::InsideCsi { ref mut is_da2 } => {
                    // Buffer overflow guard (design §2.5, DA_BUFFER_CAP = 256).
                    if self.buf.len() >= DA_BUFFER_CAP {
                        // Adversarial unterminated CSI — flush accumulated bytes.
                        out.extend_from_slice(&self.buf);
                        self.buf.clear();
                        out.push(byte);
                        self.state = State::Idle;
                        continue;
                    }

                    if byte == b'c' {
                        // Final byte is `c` → this is a DA query.
                        // `is_da2` flag was set if we saw `>` as the first param byte.
                        let reply = if *is_da2 { DA2_REPLY } else { DA1_REPLY };
                        replies.push(reply);
                        // Drop the query bytes — do NOT forward to output.
                        self.buf.clear();
                        self.state = State::Idle;
                    } else if byte == b'>' && self.buf.len() == 2 {
                        // `>` is the first param byte (buf contains ESC `[` so far).
                        // This discriminates DA2 from DA1.
                        self.buf.push(byte);
                        *is_da2 = true;
                    } else if (0x30..=0x3F).contains(&byte) {
                        // Parameter byte — keep accumulating.
                        self.buf.push(byte);
                    } else {
                        // Final byte is not `c` (e.g. `A`, `H`, `m`) → not a DA query.
                        // Flush accumulated buffer + this final byte to output.
                        self.buf.push(byte);
                        out.extend_from_slice(&self.buf);
                        self.buf.clear();
                        self.state = State::Idle;
                    }
                }
            }
        }

        (out, replies)
    }
}

impl Default for DaFilter {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── DA1 ──────────────────────────────────────────────────────────────────

    /// `ESC [ c` → DA1 reply; query bytes NOT in output.
    #[test]
    fn da1_query_yields_reply() {
        let mut f = DaFilter::new();
        let (out, replies) = f.process(b"\x1b[c");
        assert!(
            out.is_empty(),
            "DA1 query must not appear in filtered output"
        );
        assert_eq!(replies, vec![DA1_REPLY], "DA1 reply must be queued");
    }

    /// `ESC [ 0 c` → also recognised as DA1 (explicit zero parameter).
    #[test]
    fn da1_with_zero_param() {
        let mut f = DaFilter::new();
        let (out, replies) = f.process(b"\x1b[0c");
        assert!(out.is_empty(), "DA1 query with 0 must not appear in output");
        assert_eq!(replies, vec![DA1_REPLY]);
    }

    // ── DA2 ──────────────────────────────────────────────────────────────────

    /// `ESC [ > c` → DA2 reply; query bytes NOT in output.
    #[test]
    fn da2_query_yields_reply() {
        let mut f = DaFilter::new();
        let (out, replies) = f.process(b"\x1b[>c");
        assert!(
            out.is_empty(),
            "DA2 query must not appear in filtered output"
        );
        assert_eq!(replies, vec![DA2_REPLY], "DA2 reply must be queued");
    }

    /// `ESC [ > 0 c` → also recognised as DA2.
    #[test]
    fn da2_with_zero_param() {
        let mut f = DaFilter::new();
        let (out, replies) = f.process(b"\x1b[>0c");
        assert!(out.is_empty(), "DA2 query with 0 must not appear in output");
        assert_eq!(replies, vec![DA2_REPLY]);
    }

    // ── Pass-through ──────────────────────────────────────────────────────────

    /// Plain text must pass through byte-for-byte, no replies.
    #[test]
    fn normal_text_passes_through() {
        let mut f = DaFilter::new();
        let (out, replies) = f.process(b"hello");
        assert_eq!(out, b"hello");
        assert!(replies.is_empty());
    }

    /// `ESC [ A` (cursor up — final byte `A` not `c`) → must pass through.
    #[test]
    fn escape_then_non_da_csi_passes_through() {
        let mut f = DaFilter::new();
        let (out, replies) = f.process(b"\x1b[A");
        assert_eq!(out, b"\x1b[A", "cursor-up CSI must pass through unchanged");
        assert!(replies.is_empty());
    }

    /// `ESC [ 1 ; 2 H` (cursor position with params) → passes through intact.
    #[test]
    fn csi_with_intermediate_params_passes_through() {
        let mut f = DaFilter::new();
        let (out, replies) = f.process(b"\x1b[1;2H");
        assert_eq!(out, b"\x1b[1;2H");
        assert!(replies.is_empty());
    }

    /// Lone ESC followed by non-`[` byte (e.g. ESC O for SS3) must both pass.
    #[test]
    fn lone_esc_followed_by_non_bracket_passes_through() {
        let mut f = DaFilter::new();
        // ESC O P is the SS3 P sequence (F1 key in some terminals)
        let (out, replies) = f.process(b"\x1bOP");
        assert_eq!(out, b"\x1bOP");
        assert!(replies.is_empty());
    }

    // ── State persistence across calls ────────────────────────────────────────

    /// Partial DA1 sequence split across two `process()` calls.
    /// Feed `ESC [` in one call, then `c` in the next — must still yield DA1 reply.
    #[test]
    fn partial_sequence_then_flush() {
        let mut f = DaFilter::new();

        let (out1, replies1) = f.process(b"\x1b[");
        assert!(out1.is_empty(), "partial ESC [ must not emit yet");
        assert!(replies1.is_empty(), "no reply yet — sequence incomplete");

        let (out2, replies2) = f.process(b"c");
        assert!(
            out2.is_empty(),
            "completing DA1 must not forward query to output"
        );
        assert_eq!(replies2, vec![DA1_REPLY], "DA1 reply on completion");
    }

    /// ESC alone across a read boundary — followed by `[c` in the next call.
    #[test]
    fn esc_alone_then_bracket_c() {
        let mut f = DaFilter::new();
        let (out1, replies1) = f.process(b"\x1b");
        assert!(out1.is_empty());
        assert!(replies1.is_empty());

        let (out2, replies2) = f.process(b"[c");
        assert!(out2.is_empty());
        assert_eq!(replies2, vec![DA1_REPLY]);
    }

    // ── Buffer overflow ───────────────────────────────────────────────────────

    /// Feed DA_BUFFER_CAP + 1 bytes inside a CSI (no terminator) → state resets
    /// and all accumulated bytes pass through.
    #[test]
    fn buffer_overflow_releases_buffered_bytes() {
        let mut f = DaFilter::new();

        // Start an ESC [ sequence.
        let (out0, _) = f.process(b"\x1b[");
        assert!(out0.is_empty());

        // Fill the buffer up to DA_BUFFER_CAP with param bytes.
        // Each is `0` (a valid parameter byte, 0x30).
        let fill: Vec<u8> = vec![b'0'; DA_BUFFER_CAP - 2]; // -2 for ESC and [
        let (out1, replies1) = f.process(&fill);
        // Not yet overflowing — still inside CSI.
        assert!(out1.is_empty(), "should still be accumulating");
        assert!(replies1.is_empty());

        // One more byte triggers the overflow check.
        let (out2, replies2) = f.process(b"X");
        // All buffered bytes (ESC [ + fill) plus this byte must appear in output.
        let expected_len = 2 + fill.len() + 1; // ESC + [ + fill + X
        assert_eq!(
            out2.len(),
            expected_len,
            "overflow must flush all buffered bytes + triggering byte"
        );
        assert!(replies2.is_empty(), "overflow must not produce a DA reply");

        // State must be reset — subsequent plain text passes through normally.
        let (out3, _) = f.process(b"ok");
        assert_eq!(out3, b"ok");
    }

    // ── Mixed sequences ───────────────────────────────────────────────────────

    /// DA1 query embedded between plain text.
    #[test]
    fn mixed_text_da1_text() {
        let mut f = DaFilter::new();
        let (out, replies) = f.process(b"before\x1b[cafter");
        assert_eq!(out, b"beforeafter", "text around DA1 must pass through");
        assert_eq!(replies, vec![DA1_REPLY]);
    }

    /// Two consecutive DA2 queries in a single slice → two replies.
    #[test]
    fn two_da2_queries_in_one_slice() {
        let mut f = DaFilter::new();
        let (out, replies) = f.process(b"\x1b[>c\x1b[>c");
        assert!(out.is_empty());
        assert_eq!(replies, vec![DA2_REPLY, DA2_REPLY]);
    }
}
