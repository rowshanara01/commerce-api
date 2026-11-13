declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: { id: number; role: "customer" | "admin" };
    }
  }
}
export {};
