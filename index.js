const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PORT = 3000;

// Database connection settings
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'todolist',
  };


  async function retrieveListItems() {
    try {
      // Create a connection to the database
      const connection = await mysql.createConnection(dbConfig);

      // Query to select all items from the database
      const query = 'SELECT id, text FROM items';

      // Execute the query
      const [rows] = await connection.execute(query);

      // Close the connection
      await connection.end();

      // Return the retrieved items as a JSON array
      return rows;
    } catch (error) {
      console.error('Error retrieving list items:', error);
      throw error; // Re-throw the error
    }
  }

// Stub function for generating HTML rows
async function getHtmlRows() {
  const todoItems = await retrieveListItems();
  return todoItems.map(item => `
    <tr>
      <td>${item.id}</td>
      <td>${item.text}</td>
      <td>
        <!-- Форма для редактирования -->
        <form method="GET" action="/items/edit" style="display:inline;">
          <input type="hidden" name="id" value="${item.id}">
          <button type="submit">Edit</button>
        </form>
        <!-- Форма для удаления -->
        <form method="POST" action="/items/delete" style="display:inline;">
          <input type="hidden" name="id" value="${item.id}">
          <button type="submit">×</button>
        </form>
      </td>
    </tr>
  `).join('');
}

// Modified request handler with template replacement
async function handleRequest(req, res) {

// Парочка логин:пароль — для задания достаточно жёстко закодировать их здесь:
const AUTH_USER = 'admin';
const AUTH_PASS = 'secret';

// В вашей handleRequest(req, res):
const authHeader = req.headers.authorization;
if (!authHeader) {
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Secure Area"' });
  return res.end('Authentication required');
}
const [scheme, encoded] = authHeader.split(' ');
if (scheme !== 'Basic') {
  res.writeHead(400);
  return res.end('Bad authentication scheme');
}
const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
if (user !== AUTH_USER || pass !== AUTH_PASS) {
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Secure Area"' });
  return res.end('Invalid credentials');
}


    // 1) Обрабатываем GET-запрос к корню
    if (req.method === 'GET' && req.url === '/') {
        try {
            const html = await fs.promises.readFile(
                path.join(__dirname, 'index.html'),
                'utf8'
            );
            const processedHtml = html.replace('{{rows}}', await getHtmlRows());
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(processedHtml);
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            return res.end('Error loading index.html');
        }
    }

    // 2) Обрабатываем POST /items для добавления элемента
    else if (req.method === 'POST' && req.url === '/items') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const { text } = Object.fromEntries(new URLSearchParams(body));
            try {
                const conn = await mysql.createConnection(dbConfig);
                await conn.execute('INSERT INTO items (text) VALUES (?)', [text]);
                await conn.end();
                // после ввода делаем редирект на главную
                res.writeHead(302, { Location: '/' });
                return res.end();
            } catch (err) {
                console.error('Error adding item:', err);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                return res.end('Error adding item');
            }
        });
        return;  // обязательно, чтобы не упасть дальше в общий else
    }

// DELETE: обработка POST /items/delete
else if (req.method === 'POST' && req.url === '/items/delete') {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', async () => {
    const { id } = Object.fromEntries(new URLSearchParams(body));
    try {
      const conn = await mysql.createConnection(dbConfig);
      await conn.execute('DELETE FROM items WHERE id = ?', [id]);
      await conn.end();
      // после удаления — редирект обратно
      res.writeHead(302, { Location: '/' });
      return res.end();
    } catch (err) {
      console.error('Error deleting item:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Error deleting item');
    }
  });
  return;
}

// Показываем страницу редактирования
else if (req.method === 'GET' && req.url.startsWith('/items/edit')) {
  // извлекаем id из query string
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const id = urlObj.searchParams.get('id');

  try {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute(
      'SELECT id, text FROM items WHERE id = ?',
      [id]
    );
    await conn.end();

    if (rows.length === 0) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Item not found');
    }

    const item = rows[0];
    // отдаём простую HTML-страницу с формой
    const formHtml = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Edit Item</title>
        </head>
        <body>
          <h2>Edit Item #${item.id}</h2>
          <form method="POST" action="/items/edit">
            <input type="hidden" name="id" value="${item.id}">
            <input
              type="text"
              name="text"
              value="${item.text.replace(/"/g, '&quot;')}"
              required
            >
            <button type="submit">Save</button>
          </form>
        </body>
      </html>
    `;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(formHtml);

  } catch (err) {
    console.error('Error loading edit form:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    return res.end('Error loading edit form');
  }
}

// Принимаем изменения и сохраняем
else if (req.method === 'POST' && req.url === '/items/edit') {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', async () => {
    const { id, text } = Object.fromEntries(new URLSearchParams(body));
    try {
      const conn = await mysql.createConnection(dbConfig);
      await conn.execute(
        'UPDATE items SET text = ? WHERE id = ?',
        [text, id]
      );
      await conn.end();

      // после сохранения — редирект на главную
      res.writeHead(302, { Location: '/' });
      return res.end();
    } catch (err) {
      console.error('Error editing item:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Error editing item');
    }
  });
  return;
}


    // 3) Всё остальное — 404
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Route not found');
    }
}


// Create and start server
const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
