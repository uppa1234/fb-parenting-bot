export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  // ---- GET: Verification ----
  if (req.method === "GET") {
    try {
      const { ["hub.mode"]: mode, ["hub.verify_token"]: token, ["hub.challenge"]: challenge } = req.query || {};
      if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
        return res.status(200).send(challenge);  // echo back
      }
      return res.status(403).send("Forbidden");
    } catch (e) {
      console.error("VERIFY ERROR", e);
      return res.status(500).send("Server error");
    }
  }

  // ---- POST: Incoming messages ----
  if (req.method === "POST") {
    try {
      // Read raw body
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch {}

      if (body.object === "page") {
        for (const entry of body.entry || []) {
          for (const event of entry.messaging || []) {
            const senderId = event.sender?.id;
            const text = event.message?.text;
            if (!senderId || !text) continue;

            // --- OpenAI call ---
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
                  { role: "user", content: text }
                ]
              })
            });

            const data = await rsp.json().catch(() => ({}));
            const answer = data?.choices?.[0]?.message?.content?.trim() || "ขอบคุณค่ะ";

            // --- Send reply to Messenger ---
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
        return res.status(200).send("OK");
      }

      return res.status(404).send("Not found");
    } catch (e) {
      console.error("POST ERROR", e);
      return res.status(500).send("Server error");
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).send("Method Not Allowed");
}
