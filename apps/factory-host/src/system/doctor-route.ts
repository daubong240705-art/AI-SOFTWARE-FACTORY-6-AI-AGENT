import type { FastifyInstance } from "fastify";
import type { ApiGuards } from "../api/server.js";
import { doctorResponseSchema, runDoctor, type DoctorInput } from "./doctor.js";

export function registerDoctorRoute(app: FastifyInstance, guards: ApiGuards, apiVersion: number, input: () => DoctorInput): void {
  app.get<{ Querystring: { model?: string } }>("/system/doctor", { preHandler: guards.session }, async (request) => {
    const report = await runDoctor({ ...input(), checkModel: request.query.model === "1" });
    return doctorResponseSchema.parse({ ok: true, apiVersion, report });
  });
}
