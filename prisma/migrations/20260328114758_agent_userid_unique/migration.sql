/*
  Warnings:

  - A unique constraint covering the columns `[user_id]` on the table `agents` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "agents_user_id_key" ON "agents"("user_id");
