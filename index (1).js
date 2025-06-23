// Полный index.js с авторизацией, logout, CRUD и уведомлениями в Telegram
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const mysql   = require('mysql2/promise');
const cookie  = require('cookie');
const axios   = require('axios');
require('dotenv').config();

const PORT = process.env.PORT || 3000;

const dbConfig = {
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'todolist',
};

// Проверка учётных данных
async function checkUserCredentials(username, password) {
  const conn = await mysql.createConnection(dbConfig);
  const [rows] = await conn.execute(
    'SELECT 1 FROM users WHERE username = ? AND password = ?',
    [username, password]
  );
  await conn.end();
  return rows.length > 0;
}

// CRUD для элементов
async function retrieveListItems() {
  const conn = await mysql.createConnection(dbConfig);
  const [rows] = await conn.execute('SELECT id, text FROM items ORDER BY id');
  await conn.end();
  return rows;
}
async function addItemToDb(text) {
  const conn = await mysql.createConnection(dbConfig);
  await conn.execute('INSERT INTO items (text) VALUES (?)', [text]);
  await conn.end();
}
async function deleteItemFromDb(id) {
  const conn = await mysql.createConnection(dbConfig);
  await conn.execute('DELETE FROM items WHERE id = ?', [id]);
  await conn.end();
}
async function updateItemInDb(id, newText) {
  const conn = await mysql.createConnection(dbConfig);
  await conn.execute('UPDATE items SET text = ? WHERE id = ?', [newText, id]);
  await conn.end();
}

// Уведомление Telegram
async function notifyTelegram() {
  try {
    const items = await retrieveListItems();
    const now = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const list = items.length
      ? items.map((it, i) => `${i+1}. ${it.text}`).join('\n')
      : 'Список пуст.';
    const message = `📋 *Актуальный список задач:*\n${list}\n\n🕒 Обновлено: ${now}`;
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: process.env.TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Telegram notify error:', err.message);
  }
}

// Парсинг тела запроса
function handleBody(req, res, cb) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => cb(new URLSearchParams(body)).catch(err => err500(res, err)));
}
// JSON ответ
function resJson(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
// Ошибка 500
function err500(res, err) {
  console.error(err);
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'error', message: 'Server error' }));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const cookies = cookie.parse(req.headers.cookie || '');
  const isAuth  = cookies.auth === 'true';

  // Форма логина
  if (pathname === '/login' && req.method === 'GET') {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Login</title></head><body><h2 style="text-align:center;">Login</h2><form method="POST" action="/login" style="max-width:300px;margin:auto;"><input name="username" placeholder="Username" required><br><input name="password" type="password" placeholder="Password" required><br><button type="submit">Login</button></form></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }
  // Обработка логина
  if (pathname === '/login' && req.method === 'POST') {
    handleBody(req, res, async params => {
      if (await checkUserCredentials(params.get('username'), params.get('password'))) {
        res.writeHead(302, {
          'Set-Cookie': cookie.serialize('auth', 'true', { httpOnly: true }),
          Location: '/'
        });
        res.end();
      } else {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Invalid credentials');
      }
    });
    return;
  }
  // Выход
  if (pathname === '/logout' && req.method === 'GET') {
    res.writeHead(302, {
      'Set-Cookie': cookie.serialize('auth', '', { httpOnly: true, expires: new Date(0) }),
      Location: '/login'
    });
    return res.end();
  }
  // Защищённые маршруты
  if (!isAuth && pathname !== '/login') {
    res.writeHead(302, { Location: '/login' });
    return res.end();
  }
  // Главная страница
  if (pathname === '/' && req.method === 'GET') {
    try {
      const tpl = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
      const rowsHtml = (await retrieveListItems()).map((it, i) => `
        <tr>
          <td>${i+1}</td>
          <td>${it.text}</td>
          <td>
            <button onclick="location.href='/edit?id=${it.id}'">Edit</button>
            <button onclick="fetch('/delete-item',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'id=${it.id}'}).then(()=>location.reload())">×</button>
          </td>
        </tr>`).join('');
      const page = tpl.replace('{{rows}}', rowsHtml);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(page);
    } catch (err) { return err500(res, err); }
  }
  // Добавление задачи
  if (pathname === '/add-item' && req.method === 'POST') {
    handleBody(req, res, async params => {
      const text = params.get('text');
      if (text) {
        await addItemToDb(text.trim());
        await notifyTelegram();
      }
      resJson(res, { status: 'ok' });
    });
    return;
  }
  // Удаление задачи
  if (pathname === '/delete-item' && req.method === 'POST') {
    handleBody(req, res, async params => {
      const id = params.get('id');
      if (id) {
        await deleteItemFromDb(id);
        await notifyTelegram();
      }
      resJson(res, { status: 'ok' });
    });
    return;
  }
  // Форма редактирования
  if (pathname === '/edit' && req.method === 'GET') {
    const id = url.searchParams.get('id');
    try {
      const conn = await mysql.createConnection(dbConfig);
      const [rows] = await conn.execute('SELECT id,text FROM items WHERE id = ?', [id]);
      await conn.end();
      if (!rows.length) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      const it = rows[0];
      const html = `<!doctype html><html><head><meta charset=\"utf-8\"><title>Edit</title></head><body><h2>Edit #${it.id}</h2><form method=\"POST\" action=\"/update-item\"><input type=\"hidden\" name=\"id\" value=\"${it.id}\"><input type=\"text\" name=\"text\" value=\"${it.text.replace(/\"/g,'&quot;')} \" required><button type=\"submit\">Save</button></form></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    } catch (err) { return err500(res, err); }
  }
  // Сохранение изменений
  if (pathname === '/update-item' && req.method === 'POST') {
    handleBody(req, res, async params => {
      const id = params.get('id');
      const text = params.get('text');
      if (id && text) {
        await updateItemInDb(id, text.trim());
        await notifyTelegram();
      }
      res.writeHead(302, { Location: '/' });
      res.end();
    });
    return;
  }
  // Не найдено
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Route not found');
}).listen(PORT, () => console.log(`Server running on port ${PORT}`));

