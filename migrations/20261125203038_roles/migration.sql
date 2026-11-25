-- Roles das duas funções, com os verbos estreitos (data D10, D12). Nascem NOLOGIN e sem senha:
-- scripts/migrar.ts define a senha e libera o login a partir do ambiente.
-- Roles são do cluster inteiro, então podem já existir quando este banco é migrado.
DO $$ BEGIN
  CREATE ROLE precos_coletor NOLOGIN;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE ROLE precos_leitor NOLOGIN;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA precos TO precos_coletor, precos_leitor;
--> statement-breakpoint
GRANT SELECT ON precos.produto, precos.fonte TO precos_coletor;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON precos.rodada, precos.observacao TO precos_coletor;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA precos TO precos_leitor;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA precos GRANT SELECT ON TABLES TO precos_leitor;
