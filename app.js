const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const tagRoutes = require('./routes/tag');
const noteRoutes = require('./routes/note');
const commentRoutes = require('./routes/comment');
const pageRoutes = require('./routes/page');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', authRoutes);
app.use('/api', userRoutes);
app.use('/api', tagRoutes);
app.use('/api', noteRoutes);
app.use('/api', commentRoutes);
app.use('/api', pageRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 