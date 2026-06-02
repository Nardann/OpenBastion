-- AlterTable SessionRecording: add protocol and keystrokesPath columns
ALTER TABLE "SessionRecording" ADD COLUMN "protocol" TEXT NOT NULL DEFAULT 'ssh';
ALTER TABLE "SessionRecording" ADD COLUMN "keystrokesPath" TEXT;
