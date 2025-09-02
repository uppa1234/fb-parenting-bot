export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;          // set in Vercel
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const MODEL = process.env.OPENAI_MODEL || "ft:gpt-4.1-mini-2025-04-14:ceb-rama-mu::Bty4rHAc"; // or your FT model ID
//   const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini"; // or your FT model ID

  // 1) Verification (GET /api/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge); // MUST echo challenge back
    }
    return res.sendStatus(403);
  }

  // 2) Incoming events (POST)
  if (req.method === "POST") {
    // Read raw body (Vercel Node fn doesn’t auto-parse)
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch { body = {}; }

    if (body.object === "page") {
      // Iterate batched events
      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          const senderId = event.sender?.id;
          const text = event.message?.text;
          if (!senderId || !text) continue;

          // --- OpenAI call (Chat Completions) ---
          const rsp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${OPENAI_API_KEY}`
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
                { role: "user", content: text }
              ]
            })
          });
          const data = await rsp.json();
          const answer = data?.choices?.[0]?.message?.content?.trim() || "ขอบคุณค่ะ";

          // --- Send reply back to Messenger ---
          await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipient: { id: senderId },
              message: { text: answer }
            })
          });
        }
      }
      // Acknowledge within 20s
      return res.sendStatus(200);
    }

    return res.sendStatus(404);
  }

  res.setHeader("Allow", "GET, POST");
  return res.sendStatus(405);
}

