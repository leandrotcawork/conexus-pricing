/** "Estou de pé", com a versão do Node que o runtime de fato usa. */
export function respostaDeSaude(estado: { readonly dePe: boolean }): Response {
  return Response.json({ ...estado, node: process.version }, { status: estado.dePe ? 200 : 503 })
}

export function naoEncontrado(): Response {
  return Response.json({ erro: 'rota inexistente' }, { status: 404 })
}
