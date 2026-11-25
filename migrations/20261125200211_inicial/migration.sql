CREATE SCHEMA "precos";
--> statement-breakpoint
CREATE TYPE "precos"."plataforma" AS ENUM('vtex', 'tray', 'wake');--> statement-breakpoint
CREATE TYPE "precos"."situacao_observacao" AS ENUM('OK', 'SEM_ESTOQUE', 'SEM_PRECO', 'NAO_ENCONTRADO', 'ERRO');--> statement-breakpoint
CREATE TYPE "precos"."situacao_rodada" AS ENUM('RODANDO', 'CONCLUIDA', 'SUSPEITA', 'FALHOU', 'INTERROMPIDA');--> statement-breakpoint
CREATE TABLE "precos"."fonte" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "precos"."fonte_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"codigo" text NOT NULL CONSTRAINT "fonte_um_por_codigo" UNIQUE,
	"nome" text NOT NULL,
	"plataforma" "precos"."plataforma" NOT NULL,
	"config" jsonb NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	CONSTRAINT "fonte_codigo_valido" CHECK ("codigo" ~ '^[a-z][a-z0-9]{1,19}$')
);
--> statement-breakpoint
CREATE TABLE "precos"."observacao" (
	"rodada_id" integer,
	"produto_id" integer,
	"situacao" "precos"."situacao_observacao" NOT NULL,
	"preco_centavos" integer,
	"preco_lista_centavos" integer,
	"vendedor" text,
	"url" text,
	"detalhe" text,
	"cadastros" integer,
	"coletado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observacao_pk" PRIMARY KEY("rodada_id","produto_id"),
	CONSTRAINT "observacao_preco_positivo" CHECK ("preco_centavos" > 0 AND "preco_lista_centavos" > 0),
	CONSTRAINT "observacao_ok_tem_preco" CHECK ("situacao" <> 'OK' OR "preco_centavos" IS NOT NULL),
	CONSTRAINT "observacao_sem_preco_sem_valor" CHECK ("situacao" NOT IN ('SEM_PRECO', 'NAO_ENCONTRADO', 'ERRO') OR ("preco_centavos" IS NULL AND "preco_lista_centavos" IS NULL)),
	CONSTRAINT "observacao_erro_tem_detalhe" CHECK ("situacao" <> 'ERRO' OR "detalhe" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "precos"."produto" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "precos"."produto_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"codprod" text NOT NULL CONSTRAINT "produto_um_por_codprod" UNIQUE,
	"ean" text NOT NULL,
	"referencia_fabricante" text,
	"descricao" text NOT NULL,
	"marca" text,
	"nosso_preco_centavos" integer,
	"carregado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "produto_ean_valido" CHECK ("ean" ~ '^[0-9]{8,14}$'),
	CONSTRAINT "produto_nosso_preco_positivo" CHECK ("nosso_preco_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "precos"."rodada" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "precos"."rodada_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fonte_id" integer NOT NULL,
	"agendada_para" timestamp with time zone NOT NULL,
	"situacao" "precos"."situacao_rodada" NOT NULL,
	"iniciada_em" timestamp with time zone NOT NULL,
	"sinal_em" timestamp with time zone NOT NULL,
	"concluida_em" timestamp with time zone,
	"contagens" jsonb NOT NULL,
	"avisos" jsonb NOT NULL,
	"versao" text NOT NULL,
	CONSTRAINT "rodada_uma_por_agendamento" UNIQUE("fonte_id","agendada_para"),
	CONSTRAINT "rodada_aberta_so_rodando" CHECK (("situacao" = 'RODANDO') = ("concluida_em" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "precos"."observacao" ADD CONSTRAINT "observacao_rodada_id_rodada_id_fkey" FOREIGN KEY ("rodada_id") REFERENCES "precos"."rodada"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "precos"."observacao" ADD CONSTRAINT "observacao_produto_id_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "precos"."produto"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "precos"."rodada" ADD CONSTRAINT "rodada_fonte_id_fonte_id_fkey" FOREIGN KEY ("fonte_id") REFERENCES "precos"."fonte"("id") ON DELETE RESTRICT;