# A música da conta de demonstração (`appreview`)

Só gravações em domínio público ou CC0, todas da Wikimedia Commons, para a
revisão da Apple e para as capturas da App Store. Carregadas a 2026-11-08 na
conta `44vcm8mmJvuK` (`appreview@omelhorsite.pt`) pelo importador normal
(`SongServices::Importer`, o mesmo do `POST /songs/import`), em MP3 com as
etiquetas (título, artista, álbum, faixa, licença no comentário) e capas
feitas por nós (fundo de cor com o nome em Georgia; sem imagens de
terceiros).

| # | Título | Intérprete | Álbum (como aparece) | Licença | Origem |
| - | --- | --- | --- | --- | --- |
| 1 | Aria | Kimiko Ishizaka | Open Goldberg Variations | CC0 1.0 | [Commons](https://commons.wikimedia.org/wiki/File:Kimiko_Ishizaka_-_01_-_Aria.ogg), do [Free Music Archive](https://freemusicarchive.org/music/Kimiko_Ishizaka/) |
| 2 | Variatio 1 a 1 Clav. | Kimiko Ishizaka | Open Goldberg Variations | CC0 1.0 | [Commons](https://commons.wikimedia.org/wiki/File:Kimiko_Ishizaka_-_02_-_Variatio_1_a_1_Clav.ogg) |
| 3 | Aria da Capo | Kimiko Ishizaka | Open Goldberg Variations | CC0 1.0 | [Commons](https://commons.wikimedia.org/wiki/File:Kimiko_Ishizaka_-_32_-_Aria_da_Capo_Fine.ogg) |
| 4 | I. Allegro e non presto | Paul Arden-Taylor | Albinoni: Oboe Concerto Op. 9 No. 2 | CC0 1.0 | [Commons](https://commons.wikimedia.org/wiki/File:Albinoni,_Concerto_for_Oboe_and_Strings_No._2_in_D_minor,_Op._9,_I._Allegro_e_con_presto.ogg), do [Musopen](http://www.musopen.org/music/piece/825) |
| 5 | II. Adagio | Paul Arden-Taylor | Albinoni: Oboe Concerto Op. 9 No. 2 | CC0 1.0 | [Commons](https://commons.wikimedia.org/wiki/File:Albinoni,_Concerto_for_Oboe_and_Strings_No._2_in_D_minor,_Op._9,_II._Adagio.ogg), do Musopen |
| 6 | In the Steppes of Central Asia | Musopen Symphony Orchestra | Borodin: In the Steppes of Central Asia | CC0 1.0 | [Commons](https://commons.wikimedia.org/wiki/File:Alexander_Borodin_-_In_The_Steppes_Of_Central_Asia.ogg) |
| 7 | Jesus bleibet meine Freude | Orchestra Gli Armonici | Bach: Cantata BWV 147 | CC0 1.0 | [Commons](https://commons.wikimedia.org/wiki/File:Bach,_BWV_147,_10._Jesus_bleibet_meine_Freude.ogg) |
| 8 | Mandolin Concerto in C major, RV 425 | The Milan Baroque Soloists | Vivaldi: Mandolin Concerto RV 425 | Public Domain Mark (pelo dono) | [Commons](https://commons.wikimedia.org/wiki/File:Antonio_Vivaldi,_Mandolin_Concerto_in_C_major,_RV_425.ogg), do Musopen |

As obras (Bach, Albinoni, Borodin, Vivaldi) estão em domínio público há
muito; as gravações foram dedicadas pelos intérpretes (CC0) ou marcadas como
domínio público pelo dono. Licença conferida na página de cada ficheiro
(campo `LicenseShortName` da API da Commons) no dia do carregamento.

## Para que a conta só veja isto

- A biblioteca é por conta (cada `songs.user_id` é de uma pessoa); a conta
  só tem estas 8 músicas e nenhuma playlist.
- A única amiga da `appreview` é a `testios2` (do O Melhor Site), que tem 0
  músicas e 0 playlists na música: nada de outra conta chega à demo. **Não
  pôr músicas nem playlists "amigos" na `testios2`** enquanto a revisão
  estiver aberta.
- O serviço "music" foi ligado à mão à conta (`user_services`), porque vem
  desligado nas contas novas.

Conferir:

```sh
ssh mini 'export PATH=/usr/local/bin:$PATH; docker exec -i oms-music-backend bin/rails runner "u=User.find(\"44vcm8mmJvuK\"); p u.service_enabled?(:music); p Song.where(user_id: u.id).pluck(:title); u.friends.each{|f| p [f.handle, Song.where(user_id: f.id).count, Playlist.where(user_id: f.id, visibility: \"friends\").count]}" 2>/dev/null'
```
