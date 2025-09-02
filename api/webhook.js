// File: api/webhook.js
// Vercel serverless function (Node.js). No Express required.

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;              // you choose this
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;    // from Messenger → Access Tokens
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;          // your OpenAI key
  const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";   // or your FT model id

  // --- GET: Facebook webhook verification ---
  if (req.method === "GET") {
    try {
      const q = req.query || {};
      const mode = q["hub.mode"];
      const token = q["hub.verify_token"];
      const challenge = q["hub.challenge"];
      if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
        return res.status(200).send(challenge); // MUST echo back challenge as plain text
      }
      return res.status(403).send("Forbidden");
    } catch (e) {
      console.error("VERIFY ERROR", e);
      return res.status(500).send("Server error");
    }
  }

  // --- POST: Incoming Messenger events ---
  if (req.method === "POST") {
    try {
      // Read raw body (Vercel doesn't auto-parse here)
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }

      console.log("WEBHOOK EVENT:", JSON.stringify(body));

      if (body.object !== "page") {
        return res.status(404).send("Not a page event");
      }

      const entries = Array.isArray(body.entry) ? body.entry : [];
      for (const entry of entries) {
        const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
        for (const event of messaging) {
          const senderId = event?.sender?.id;
          const messageText =
            event?.message?.text ??
            event?.postback?.title ??
            event?.postback?.payload ??
            null;

          if (!senderId) continue;

          // Ignore non-text messages gracefully
          if (!messageText) {
            await fbSendText(PAGE_ACCESS_TOKEN, senderId, "ขอบคุณค่ะ (ตอนนี้รองรับข้อความตัวอักษรเท่านั้น)");
            continue;
          }

          // --- Try OpenAI; fall back to echo if anything fails ---
          let answer = "";
          try {
            const rsp = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`
              },
              body: JSON.stringify({
                model: MODEL,
                temperature: 0.3,
                messages: [
                  {
                    role: "system",
                    content:
                      "คุณเป็นจิตแพทย์เด็กและวัยรุ่นที่ให้คำแนะนำแก่ผู้ปกครอง เกี่ยวกับการเลี้ยงดูบุตร " +
                      "ตอบคำถามด้วยความเห็นอกเห็นใจ ชัดเจน และอิงหลักฐานทางวิชาการ " +
                      "ถ้าข้อมูลไม่พอ ให้ถามกลับ แล้วสรุปคำตอบ"
                  },
                  { role: "user", content: messageText }
                ]
              })
            });

            const data = await rsp.json().catch(() => ({}));
            if (!rsp.ok) {
              console.error("OPENAI ERROR", rsp.status, data);
            }
            answer = data?.choices?.[0]?.message?.content?.trim() || "";
          } catch (e) {
            console.error("OPENAI EXCEPTION", e);
          }

          const reply = answer || `ขอบคุณค่ะ (โหมดสำรอง): ${messageText}`;
          const fbResp = await fbSendText(PAGE_ACCESS_TOKEN, senderId, reply);
          console.log("FB SEND STATUS", fbResp.status, await fbResp.text());
        }
      }

      return res.status(200).send("OK");
    } catch (e) {
      console.error("POST ERROR", e);
      return res.status(500).send("Server error");
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).send("Method Not Allowed");
}

// --- Helper: send a text message back to the user on Messenger ---
async function fbSendText(PAGE_ACCESS_TOKEN, recipientId, text) {
  return fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text }
    })
  });
}
