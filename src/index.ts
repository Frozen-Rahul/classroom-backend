import express, { type Request, type Response } from "express";
import { initializeDatabase, pool } from "./db/db.js";

const app = express();
const PORT = Number(process.env.PORT ?? 8000);

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.CORS_ORIGIN ?? "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const teachers = [
  { id: "1", name: "John Doe", email: "john@example.com", role: "teacher" },
  { id: "2", name: "Jane Smith", email: "jane@example.com", role: "teacher" },
  { id: "3", name: "Alan Turing", email: "alan@example.com", role: "teacher" },
];

const notFound = (res: Response, resource: string) =>
  res.status(404).json({ message: `${resource} was not found` });

const isScheduleList = (value: unknown): value is { day: string; startTime: string; endTime: string }[] =>
  Array.isArray(value) && value.every((schedule) =>
    schedule !== null && typeof schedule === "object" &&
    typeof schedule.day === "string" && schedule.day.trim() !== "" &&
    typeof schedule.startTime === "string" && schedule.startTime.trim() !== "" &&
    typeof schedule.endTime === "string" && schedule.endTime.trim() !== "",
  );

const isNullableId = (value: unknown) => value === null || (Number.isSafeInteger(value) && Number(value) > 0);
const isNullableString = (value: unknown) => value === null || typeof value === "string";

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Hello from classroom backend" });
});

app.get("/api/health", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<{ result: number }>("SELECT 1 AS result");
    res.json({ status: "ok", database: rows[0]?.result === 1 ? "connected" : "error" });
  } catch (error) {
    console.error("Database health check failed", error);
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

app.get("/api/users", (_req: Request, res: Response) => {
  res.json({ data: teachers, total: teachers.length });
});

app.get("/api/subjects", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query("SELECT id, name, code, department, description FROM subjects ORDER BY id");
    res.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error("Could not list subjects", error);
    res.status(500).json({ message: "Could not list subjects" });
  }
});

app.get("/api/subjects/:id", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query("SELECT id, name, code, department, description FROM subjects WHERE id = $1", [req.params.id]);
    if (!rows[0]) return notFound(res, "Subject");
    res.json({ data: rows[0] });
  } catch (error) {
    console.error("Could not get subject", error);
    res.status(500).json({ message: "Could not get subject" });
  }
});

app.post("/api/subjects", async (req: Request, res: Response) => {
  const { name, code, department, description = "" } = req.body ?? {};
  if (![name, code, department].every((value) => typeof value === "string" && value.trim())) {
    return res.status(400).json({ message: "name, code, and department are required" });
  }
  try {
    const { rows } = await pool.query(
      "INSERT INTO subjects (name, code, department, description) VALUES ($1, $2, $3, $4) RETURNING id, name, code, department, description",
      [name.trim(), code.trim(), department.trim(), description],
    );
    res.status(201).json({ data: rows[0] });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ message: "A subject with this code already exists" });
    console.error("Could not create subject", error);
    res.status(500).json({ message: "Could not create subject" });
  }
});

app.patch("/api/subjects/:id", async (req: Request, res: Response) => {
  const { name, code, department, description } = req.body ?? {};
  try {
    const { rows } = await pool.query(
      `UPDATE subjects SET name = COALESCE($2, name), code = COALESCE($3, code),
       department = COALESCE($4, department), description = COALESCE($5, description)
       WHERE id = $1 RETURNING id, name, code, department, description`,
      [req.params.id, name, code, department, description],
    );
    if (!rows[0]) return notFound(res, "Subject");
    res.json({ data: rows[0] });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ message: "A subject with this code already exists" });
    console.error("Could not update subject", error);
    res.status(500).json({ message: "Could not update subject" });
  }
});

app.delete("/api/subjects/:id", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query("DELETE FROM subjects WHERE id = $1 RETURNING id, name, code, department, description", [req.params.id]);
    if (!rows[0]) return notFound(res, "Subject");
    res.json({ data: rows[0] });
  } catch (error) {
    console.error("Could not delete subject", error);
    res.status(500).json({ message: "Could not delete subject" });
  }
});

app.get("/api/classes", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.subject_id AS "subjectId", c.teacher_id AS "teacherId",
       c.status, c.capacity, c.description, c.schedules,
       CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object('id', s.id, 'name', s.name, 'code', s.code, 'department', s.department, 'description', s.description) END AS subject
       FROM classes c LEFT JOIN subjects s ON s.id = c.subject_id ORDER BY c.id`,
    );
    const data = rows.map((row) => ({
      ...row,
      teacher: teachers.find((teacher) => teacher.id === String((row as { teacherId?: unknown }).teacherId)),
    }));
    res.json({ data, total: data.length });
  } catch (error) {
    console.error("Could not list classes", error);
    res.status(500).json({ message: "Could not list classes" });
  }
});

app.get("/api/classes/:id", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.subject_id AS "subjectId", c.teacher_id AS "teacherId",
       c.status, c.capacity, c.description, c.schedules,
       CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object('id', s.id, 'name', s.name, 'code', s.code, 'department', s.department, 'description', s.description) END AS subject
       FROM classes c LEFT JOIN subjects s ON s.id = c.subject_id WHERE c.id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return notFound(res, "Class");
    const row = rows[0];
    res.json({ data: { ...row, teacher: teachers.find((teacher) => teacher.id === String(row.teacherId)) } });
  } catch (error) {
    console.error("Could not get class", error);
    res.status(500).json({ message: "Could not get class" });
  }
});

app.post("/api/classes", async (req: Request, res: Response) => {
  const { name, subjectId = null, teacherId = null, status = "active", capacity = 30, description = "", schedules = [] } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || !Number.isSafeInteger(capacity) || capacity < 1 ||
      !isNullableId(subjectId) || !isNullableString(teacherId) ||
      !["active", "inactive"].includes(status) || typeof description !== "string" || !isScheduleList(schedules)) {
    return res.status(400).json({ message: "Invalid class data: provide a name, positive integer capacity, valid status, nullable subjectId/teacherId, string description, and valid schedules" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO classes (name, subject_id, teacher_id, status, capacity, description, schedules)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, name, subject_id AS "subjectId", teacher_id AS "teacherId", status, capacity, description, schedules`,
      [name.trim(), subjectId, teacherId, status, capacity, description, JSON.stringify(schedules)],
    );
    res.status(201).json({ data: rows[0] });
  } catch (error) {
    console.error("Could not create class", error);
    res.status(500).json({ message: "Could not create class" });
  }
});

app.patch("/api/classes/:id", async (req: Request, res: Response) => {
  const { name, subjectId, teacherId, status, capacity, description, schedules } = req.body ?? {};
  if ((name !== undefined && (typeof name !== "string" || !name.trim())) ||
      (subjectId !== undefined && !isNullableId(subjectId)) ||
      (teacherId !== undefined && !isNullableString(teacherId)) ||
      (status !== undefined && !["active", "inactive"].includes(status)) ||
      (capacity !== undefined && (!Number.isSafeInteger(capacity) || capacity < 1)) ||
      (description !== undefined && typeof description !== "string") ||
      (schedules !== undefined && !isScheduleList(schedules))) {
    return res.status(400).json({ message: "Invalid class data" });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE classes SET name = CASE WHEN $2 THEN $3 ELSE name END,
       subject_id = CASE WHEN $4 THEN $5 ELSE subject_id END,
       teacher_id = CASE WHEN $6 THEN $7 ELSE teacher_id END,
       status = CASE WHEN $8 THEN $9 ELSE status END,
       capacity = CASE WHEN $10 THEN $11 ELSE capacity END,
       description = CASE WHEN $12 THEN $13 ELSE description END,
       schedules = CASE WHEN $14 THEN $15::jsonb ELSE schedules END
       WHERE id = $1 RETURNING id, name, subject_id AS "subjectId", teacher_id AS "teacherId", status, capacity, description, schedules`,
      [req.params.id,
        name !== undefined, name?.trim(),
        subjectId !== undefined, subjectId,
        teacherId !== undefined, teacherId,
        status !== undefined, status,
        capacity !== undefined, capacity,
        description !== undefined, description,
        schedules !== undefined, schedules === undefined ? null : JSON.stringify(schedules)],
    );
    if (!rows[0]) return notFound(res, "Class");
    res.json({ data: rows[0] });
  } catch (error) {
    console.error("Could not update class", error);
    res.status(500).json({ message: "Could not update class" });
  }
});

app.delete("/api/classes/:id", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM classes WHERE id = $1 RETURNING id, name, subject_id AS "subjectId", teacher_id AS "teacherId", status, capacity, description, schedules`,
      [req.params.id],
    );
    if (!rows[0]) return notFound(res, "Class");
    res.json({ data: rows[0] });
  } catch (error) {
    console.error("Could not delete class", error);
    res.status(500).json({ message: "Could not delete class" });
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  console.error("Unhandled request error", error);
  res.status(500).json({ message: "Internal server error" });
});

async function start() {
  await initializeDatabase();
  const server = app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
  const shutdown = () => server.close(() => void pool.end());
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error("Could not start classroom backend", error);
  process.exitCode = 1;
});
