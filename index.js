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
    // Example data - replace with actual DB data later
    /*
    const todoItems = [
        { id: 1, text: 'First todo item' },
        { id: 2, text: 'Second todo item' }
    ];*/

    const todoItems = await retrieveListItems();

    // Generate HTML for each item
    return todoItems.map(item => `
        <tr>
            <td>${item.id}</td>
            <td>${item.text}</td>
            <td><button class="delete-btn">×</button></td>
        </tr>
    `).join('');
}

// Modified request handler with template replacement
async function handleRequest(req, res) {
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

    // 3) Всё остальное — 404
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Route not found');
    }
}


// Create and start server
const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
