-- Os tamanhos de lote são os do MetalPrice (vtex.py:21-22, tray.py:32-36, wake.py:36-38).
-- A ABC nasce sem `tokenReserva`: o valor é da loja e não entra neste repositório público.
INSERT INTO precos.fonte (codigo, nome, plataforma, config) VALUES
  ('telhanorte', 'Telha Norte', 'vtex',
    '{"origem": "https://www.telhanorte.com.br", "lote": 50}'),
  ('condec', 'Condec', 'tray',
    '{"origem": "https://www.condec.com.br", "lote": 25}'),
  ('abc', 'ABC da Construção', 'wake',
    '{"loja": "https://www.abcdaconstrucao.com.br", "api": "https://storefront-api.fbits.net/graphql", "lote": 25}')
ON CONFLICT (codigo) DO NOTHING;
