-- Lojas das plataformas que já temos, com os mesmos tamanhos de lote.
-- A Balaroti nasce sem `tokenReserva`, como a ABC: o valor é da loja.
INSERT INTO precos.fonte (codigo, nome, plataforma, config) VALUES
  ('balaroti', 'Balaroti', 'wake',
    '{"loja": "https://www.balaroti.com.br", "api": "https://storefront-api.fbits.net/graphql", "lote": 25}'),
  ('copafer', 'Copafer', 'vtex',
    '{"origem": "https://www.copafer.com.br", "lote": 50}'),
  ('queroquero', 'Quero-Quero', 'vtex',
    '{"origem": "https://www.queroquero.com.br", "lote": 50}'),
  ('amoedo', 'Amoedo', 'vtex',
    '{"origem": "https://www.amoedo.com.br", "lote": 50}')
ON CONFLICT (codigo) DO NOTHING;
