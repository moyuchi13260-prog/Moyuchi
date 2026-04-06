const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('服务器运行成功！');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});