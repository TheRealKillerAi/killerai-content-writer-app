/** Sends an email through Resend. Returns false (and logs) if email isn't configured or the send fails. */
export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<boolean> {
  // eslint-disable-next-line no-undef
  const key = process.env.RESEND_API_KEY;
  // eslint-disable-next-line no-undef
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !opts.to) {
    console.warn("Email not sent: RESEND_API_KEY, EMAIL_FROM or the recipient is missing.");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html }),
    });
    if (!res.ok) console.error("Resend error", res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error("Email failed", e);
    return false;
  }
}
