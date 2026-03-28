-- CreateTable
CREATE TABLE "auto_trading_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "interval_hours" INTEGER NOT NULL DEFAULT 2,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_trading_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_bet_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "prediction_id" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_bet_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auto_trading_settings_user_id_key" ON "auto_trading_settings"("user_id");

-- AddForeignKey
ALTER TABLE "auto_trading_settings" ADD CONSTRAINT "auto_trading_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_bet_history" ADD CONSTRAINT "ai_bet_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
