CREATE TYPE "precos"."classe" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TABLE "precos"."grupo" (
	"codigo" integer PRIMARY KEY,
	"nome" text NOT NULL,
	"pai" integer,
	"grau" integer NOT NULL,
	"analitico" boolean NOT NULL,
	"ativo" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "precos"."produto" ADD COLUMN "grupo_codigo" integer;--> statement-breakpoint
ALTER TABLE "precos"."produto" ADD COLUMN "classe" "precos"."classe";--> statement-breakpoint
ALTER TABLE "precos"."produto" ADD COLUMN "venda_12m_centavos" bigint;--> statement-breakpoint
ALTER TABLE "precos"."grupo" ADD CONSTRAINT "grupo_pai_existe" FOREIGN KEY ("pai") REFERENCES "precos"."grupo"("codigo") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "precos"."produto" ADD CONSTRAINT "produto_grupo_codigo_grupo_codigo_fkey" FOREIGN KEY ("grupo_codigo") REFERENCES "precos"."grupo"("codigo") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "precos"."produto" ADD CONSTRAINT "produto_venda_12m_nao_negativa" CHECK ("venda_12m_centavos" >= 0);