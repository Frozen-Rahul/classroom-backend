import express, { Request, Response } from 'express';

const app = express();
const PORT = 8000;

app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'Hello from classroom backend' });
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
