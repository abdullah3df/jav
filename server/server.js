// server/server.js
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import 'dotenv/config';

const app = express();

// إذا واجهة على دومين/منفذ آخر: عدّل origin أدناه أو استخدم نفس الدومين
app.use(cors({
  origin: true, // يسمح بالمصدر القادم، أو ضع: ['http://localhost:5173']
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

app.use(session({
  name: 'studiokey',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // غيّر إلى true في الإنتاج خلف HTTPS
    maxAge: 1000 * 60 * 60 * 8 // 8 ساعات
  }
}));

// تسجيل الدخول (حفظ API Key في السيشن)
app.post('/api/login', (req, res) => {
  const { api_key } = req.body || {};
  if (!api_key || !/^sk-[\w-]{10,}/.test(api_key)) {
    return res.status(400).json({ error: 'Invalid API key' });
  }
  req.session.apiKey = api_key;
  res.json({ ok: true });
});

// تسجيل الخروج
app.post('/api/logout', (req, res) => {
  req.session.destroy(()=> res.json({ ok: true }));
});

// فحص الجلسة
app.get('/api/session', (req, res) => {
  res.json({ logged_in: Boolean(req.session.apiKey) });
});

// الذكاء الاصطناعي (Streaming)
app.post('/api/ai', async (req, res) => {
  try {
    const apiKey = req.session.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Not logged in' });

    const { model = 'gpt-4.1', system = '', prompt = '' } = req.body || {};
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: true,
        input: [
          { role: 'system', content: [{ type: 'text', text: system.slice(0, 6000) }] },
          { role: 'user',   content: [{ type: 'text', text: prompt }] }
        ],
        max_output_tokens: 1200
      })
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      return res.status(upstream.status || 500).end(text);
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const reader = upstream.body.getReader();
    const encoder = new TextEncoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);

      const parts = buffer.split('\n\n');
      buffer = parts.pop();

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload);
          const delta = evt?.output_text?.delta;
          if (delta) res.write(encoder.encode(delta));
        } catch {}
      }
    }
    res.end();
  } catch (err) {
    res.status(500).send(err?.message || 'Server error');
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log('AI Studio server listening on', PORT));
