/**
 * Rota-fantasma do item "Perfil". A barra nativa nao sabe desenhar itens que
 * nao sejam rotas, e o Perfil nunca foi um destino: abre a gaveta. O trigger
 * correspondente e `disabled`, portanto o toque nunca chega a mostrar este
 * ecra; existe so para o navegador de tabs ter um filho valido por baixo do
 * item.
 *
 * Fica solta em (tabs) e nao dentro de um grupo `(account)`: um grupo sem
 * _layout.tsx e achatado pelo expo-router e a rota passaria a chamar-se
 * "(account)/account", nome que nenhum trigger consegue referenciar
 * (verificado com o getRoutes real, 2026-08-15).
 */
export default function AccountTabRoute() {
  return null;
}
