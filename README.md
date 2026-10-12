# 🐾 Nodistub Cat Cafe — Discord Music Bot

บอทเพลงธีมคาเฟ่แมว เล่นเพลงจากไฟล์เสียงที่อัปโหลดไว้ในช่องของหมวดหมู่ `1558578154820604014`
และเล่นในห้อง `1486496068295331932` โดย **สั่งเพลงได้จากเว็บเท่านั้น** (บอทไม่มีคำสั่งในแชท)

## ความสามารถ

- ดึงชื่อช่องทั้งหมดในหมวดหมู่ เป็นหมวดเพลงบนเว็บ และดึงไฟล์เสียง (mp3, wav, ogg, flac, m4a, aac, opus ...) จากข้อความในช่องนั้น
- เว็บเลือกเพลงต่อคิวได้, ฟังตัวอย่าง 30 วินาที, ค้นหา/เรียงลำดับ
- เห็นคิวแบบ real-time, เพลงที่ถูกขอบ่อย (Most requested), จำนวนครั้งที่ถูกขอ/ถูกเล่นของแต่ละเพลง
- ป้าย **NEW** + แถบ "Fresh from the oven" + toast เด้งทันทีเมื่อมีคนอัปโหลดเพลงใหม่
- ไม่มีใครต่อคิว → สุ่มเพลงจากทั้งหมวดอัตโนมัติ (ไม่ซ้ำกับ 12 เพลงล่าสุด)
- เล่นเฉพาะตอนมีคนอยู่ในห้อง ถ้าห้องว่างจะหยุดชั่วคราวและเล่นต่อเมื่อมีคนเข้า
- บอทเข้าห้องอัตโนมัติและไม่ออก (ถ้าโดนย้าย/เตะ/หลุด จะกลับเข้ามาเอง)
- สถานะ Discord เป็น Do Not Disturb (`dnd`) และแสดง `Listening to <ชื่อเพลง>` (อังกฤษล้วน)
- ห้องฟังเพลง: ปิดไมค์ / แชร์จอ / เปิดกล้อง / soundboard (ตั้ง permission ให้ @everyone อัตโนมัติ) ส่วนห้องเสียงอื่นพูดคุยได้ปกติ
- เว็บแอนิเมชันธีม Music Studio: แผ่นเสียงหมุน, แขน turntable, แมวใส่หูฟังโยกตามจังหวะ, ไอน้ำกาแฟ, equalizer, โน้ตลอยเบา ๆ (แมวจะหลับเมื่อไม่มีเพลง)

## ติดตั้ง

ต้องใช้ **Node.js 20+**

```bash
npm install
cp .env.example .env     # แล้วใส่ DISCORD_TOKEN และ GUILD_ID
npm start
```

เปิดเว็บที่ `http://localhost:3000`

### สร้างบอท

1. https://discord.com/developers/applications → New Application → Bot → Reset Token (เอาไปใส่ `DISCORD_TOKEN`)
2. ในแท็บ Bot → Privileged Gateway Intents ให้ **เปิด Message Content Intent** แล้วกด Save (จำเป็น ไม่งั้นบอทจะมองไม่เห็นไฟล์เพลงในข้อความ)
3. เชิญบอทด้วย scope `bot` และ permission:
   - View Channels, Read Message History (ช่องในหมวดเพลง)
   - Connect, Speak (ห้องฟังเพลง)
   - **Manage Channels** (เพื่อตั้งกฎห้องฟังเพลงให้อัตโนมัติ)
   - **Move Members** (เพื่อเตะคนที่พยายามแชร์จอ/เปิดกล้อง)
4. เปิด Developer Mode ใน Discord แล้วคลิกขวาที่เซิร์ฟเวอร์ → Copy Server ID ใส่ `GUILD_ID`

### วิธีเพิ่มเพลง

อัปโหลดไฟล์เสียงเป็นข้อความในช่องใดก็ได้ในหมวดหมู่เพลง ชื่อไฟล์จะกลายเป็นชื่อเพลง (`_` จะถูกแทนด้วยช่องว่าง) ช่องแต่ละช่องคือหนึ่งหมวดบนเว็บ

> ลิงก์ไฟล์ของ Discord หมดอายุเป็นระยะ บอทจะดึงลิงก์ใหม่จากข้อความเดิมให้เองทุกครั้งที่เล่น/พรีวิว ดังนั้นห้ามลบข้อความที่อัปโหลดเพลง

## เปิดให้คนอื่นเข้าเว็บ

เว็บรันที่พอร์ต `PORT` (ค่าเริ่มต้น 3000) ถ้าจะให้เพื่อนเข้า:
- ใช้ Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3000`) หรือ ngrok
- หรือเปิดพอร์ตบน VPS/เราเตอร์ แล้วตั้ง `TRUST_PROXY=true` หากอยู่หลัง proxy

เว็บมี rate limit ต่อ IP (ค่าเริ่มต้น 4 คำขอ / 30 วินาที) และจำกัดคิวสูงสุด 30 เพลง ปรับได้ใน `.env`

## Deploy บน Render

1. push โปรเจกต์ขึ้น GitHub แล้วสร้าง **Web Service** บน Render (หรือใช้ `render.yaml` เป็น Blueprint)
2. Build Command: `npm install` · Start Command: `npm start` · Health Check Path: `/healthz`
3. ใส่ Environment: `DISCORD_TOKEN`, `GUILD_ID` (ส่วน `PORT` กับ proxy Render ตั้งให้เอง) และแนะนำ `NODE_VERSION=22`
4. เว็บจะอยู่ที่ `https://ชื่อ-service.onrender.com`

ข้อควรระวัง:
- **แพ็กฟรีจะหลับหลังไม่มีคนเข้าเว็บ 15 นาที** บอทจะหลุดออกจากห้อง ควรใช้แพ็ก **Starter** ขึ้นไปเพื่อให้บอทอยู่ตลอด 24 ชม.
- ดิสก์ของ Render ถูกล้างทุกครั้งที่ deploy สถิติ (`stats.json`) จะหาย ถ้าอยากเก็บไว้ ให้เพิ่ม Persistent Disk (แพ็กเสียเงิน) mount ที่ `/var/data` แล้วตั้ง `DATA_DIR=/var/data`
- ต้องเป็น Web Service (ไม่ใช่ Background Worker) เพราะมีหน้าเว็บ

## หน้าพักหน้าจอ (Sakura Cat Window)

กดปุ่ม **🌸 Screensaver** บนหัวเว็บ หรือปล่อยหน้าเว็บไว้เฉย ๆ 90 วินาทีมันจะเปิดเอง (ปิดได้ที่ปุ่ม 💤 Auto)
- ฉากฟ้าเปลี่ยนตามเวลาเครื่องของคนดู: เช้า / กลางวัน / เย็น / พระอาทิตย์ตก / กลางคืน (มีดาว พระจันทร์ หิ่งห้อย)
- นาฬิกาใหญ่ + วันที่ (สลับ 12h/24h ได้) กิ่งซากุระโยกเบา ๆ กลีบร่วง เมฆลอย
- แตะแมวเพื่อลูบ (ได้หัวใจ + กลีบซากุระ + นับจำนวนครั้ง) แตะท้องฟ้าให้กลีบฟุ้ง กด 🍃 Gust ให้ลมพัด
- การ์ดแสดงเพลงที่กำลังเล่น + แถบเวลา + equalizer
- **🔁 Loop**: ลูปเพลงปัจจุบัน (มีผลกับทุกคนในห้อง ถ้ามีคนสั่งเพลงใหม่ ลูปจะปิดเอง)
- **🔊 Sound**: เล่นเพลงเดียวกันในหน้าเว็บนี้ด้วย (ซิงก์กับห้อง) อย่าเปิดถ้าคุณอยู่ในห้องเสียง Discord เพราะเสียงจะซ้อนกัน
- กด Esc เพื่อออก

> บอท Discord แชร์หน้าจอ/ไลฟ์ไม่ได้ (Discord ไม่เปิดให้บอทส่งวิดีโอ) ถ้าอยากให้คนอื่นเห็นหน้านี้ ให้เปิดเว็บแล้วแชร์หน้าจอด้วยบัญชีของคุณเองในห้องเสียงอื่น (ห้องฟังเพลงห้ามแชร์จอ) หรือเปิดทิ้งไว้บนทีวี/แท็บเล็ต

## ชื่อเพลง

Discord ตัดตัวอักษรที่ไม่ใช่ภาษาอังกฤษ (เช่นญี่ปุ่น/ไทย) ออกจากชื่อไฟล์ ทำให้ชื่อกลายเป็นรหัสหรือเหลือแค่บางคำ บอทจึงหาชื่อเพลงตามลำดับนี้:
1. ชื่อเพลง (title) ที่ Discord อ่านจากไฟล์
2. **ข้อความที่พิมพ์ในโพสต์เดียวกัน** (บรรทัดแรก) ใช้ได้เมื่อโพสต์นั้นมีไฟล์เสียงไฟล์เดียว
3. ชื่อไฟล์ ถ้าอ่านรู้เรื่อง
4. แท็ก ID3 ที่ฝังอยู่ในไฟล์ mp3 (ชื่อเพลง/ศิลปิน)
ถ้าไม่เจอเลยจะขึ้น `Untitled track (ขนาดไฟล์)`  วิธีง่ายที่สุดคือพิมพ์ชื่อเพลงเป็นข้อความตอนอัปโหลด เช่น ลากไฟล์ใส่แล้วพิมพ์ `だらけモードON` ก่อนกดส่ง

## ข้อควรรู้

- **แอดมิน/คนที่มี Administrator จะข้าม permission ของห้อง** จึงยังพูดได้ นี่เป็นข้อจำกัดของ Discord
- ถ้ามี role อื่นที่ตั้งสิทธิ์ Speak = อนุญาตเฉพาะห้องนี้ ให้เอาออก เพราะจะทับกฎของ @everyone
- ถ้าบอทเข้าห้องแล้วไม่มีเสียง: อัปเดตแพ็กเกจ (`npm update`) เพราะ Discord บังคับใช้เสียงแบบ DAVE (E2EE) และแพ็กเกจ `@discordjs/voice` + `@snazzah/davey` ต้องเป็นเวอร์ชันล่าสุด
- ถ้าอยากได้คุณภาพเสียง/CPU ที่ดีขึ้น ติดตั้ง `@discordjs/opus` แทน `opusscript` ได้
- สถิติ (จำนวนครั้งที่ขอ/เล่น) เก็บไว้ที่ `data/stats.json`

## โครงสร้างไฟล์

```
src/index.js     บอท, presence, กฎห้อง, event ต่าง ๆ
src/library.js   สแกนช่องในหมวด ดึงไฟล์เสียง และรีเฟรชลิงก์
src/player.js    เข้าห้อง, คิว, สุ่มอัตโนมัติ, หยุด/เล่นตามคนฟัง
src/web.js       Express API + SSE + พรีวิวเพลง
src/stats.js     นับจำนวนครั้งที่ถูกขอ/เล่น
public/          หน้าเว็บ (HTML/CSS/JS)
```

---

## Live overlay (`/overlay`) and control panel (`/control-live`)

The music site now lives at `/Music`.

**Render env vars to add:** `CONTROL_PIN` (your PIN) and `YT_API_KEY` (YouTube Data API v3 key).
Optional: `YT_VIDEO_ID`, `LIVE_FOLDER_ID`, `LIVE_STORAGE_ID`, `YT_MIN_POLL_MS`, `YT_STATS_SEC`, `LIVE_SECRET`.

**YouTube API key:** Google Cloud Console > create project > enable "YouTube Data API v3" > Credentials > Create API key.
Chat polling costs 5 quota units per poll (default quota 10,000/day), so the bot polls no faster than `YT_MIN_POLL_MS`.

**Discord:** the bot needs View Channel, Read Message History, Send Messages, Attach Files, Embed Links in the Live folder and Live storage channels.
Name your files: `setlivescreen.mp4` (starting-soon video) and `Translation.mp4` (transition video). Other videos, images and audio in the Live folder show up in the Media / Music tabs.
Live storage receives a summary after every live (views, subscribers, comments, Super Chat totals) and is read back on boot.

**OBS:** Add a Browser Source, URL `https://YOUR-APP.onrender.com/overlay`, 1920x1080, tick "Control audio via OBS" if you want. Open `/control-live`, enter the PIN, press Start live, then "I'm ready".
MP4 cannot hold transparency; for a see-through prep video use WebM (VP9 alpha) or the blend-mode option in the Look tab.
