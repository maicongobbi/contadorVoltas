# Contador de Voltas na Piscina: especificação para implementação

## 1. Objetivo

Criar um app que roda no **celular** e usa a **câmera** para contar automaticamente quantas vezes cada nadador chega à extremidade da piscina onde o celular está. Ele precisa contar **separadamente por raia** (até 8; o normal são 6) e converter as chegadas em metros.

O app tem que ficar ligado por longos períodos (treinos de 1 a 2 horas), filmando e contando sem ninguém mexer.

### Mudança importante em relação ao protótipo

O protótipo atual (`prototipo/index.html`, que vai junto como referência) detecta movimento **só numa faixa sobre a parede**. Isso falha com a **virada olímpica**: o nadador mergulha antes de tocar a parede, gira debaixo d'água e empurra a parede com os pés. Nesse momento ele praticamente some da superfície junto à parede.

**Nova abordagem:** filmar o **terço final da piscina** (cerca de 8 m antes da parede, numa piscina de 25 m) e detectar o **padrão de aproximação e afastamento** do nadador em cada raia, em vez de detectar o toque na parede.

---

## 2. Cenário de uso

- Piscina semiolímpica de **25 m**; o comprimento deve ser configurável (25 ou 50 m, ou outro valor).
- O celular fica **fixo** num tripé ou suporte, numa das extremidades, no alto (o ideal é entre 2 e 3 m de altura), olhando para dentro da piscina, de modo que apareçam:
  - a parede de chegada, na parte de baixo da imagem;
  - as raias lado a lado;
  - até cerca de 8 m de distância a partir da parede (o terço final).
- **Modos de enquadramento** suportados:
  - **6 a 8 raias:** câmera no meio da parede, em posição alta, com lente grande-angular, se o aparelho tiver.
  - **1 ou 2 raias:** câmera na borda, olhando a raia de cima. É o caso mais confiável e deve funcionar muito bem.
- Pode haver **mais de um nadador por raia**. Na v1, aceita-se que a contagem seja por raia, não por pessoa (ver seção 9).

---

## 3. Regra de contagem e distância

A câmera só vê **uma** extremidade. Por isso:

- Cada **chegada** detectada nessa extremidade = o nadador foi até a outra ponta e voltou.
- Configuração "nadador começa":
  - **Na outra ponta:** 1ª chegada = 25 m; cada chegada seguinte = +50 m. Fórmula: `L + 2L·(n−1)`.
  - **Do lado da câmera:** cada chegada = 50 m. Fórmula: `2L·n`.
- Mostrar, por raia: **número de chegadas**, **metros**, **tempo da última parcial** (tempo entre duas chegadas = 50 m) e **tempo total**.

---

## 4. Plataforma e stack

- **PWA** (web app instalável) com HTTPS, porque a câmera só funciona em contexto seguro.
- **TypeScript + Vite**, sem framework pesado (vanilla ou Preact). O processamento de imagem fica num **Web Worker** para não travar a interface.
- APIs: `getUserMedia` (câmera traseira), `Screen Wake Lock API` (tela sempre ligada), `WebAudio` (bipe), `localStorage` ou IndexedDB (configuração e histórico), `requestVideoFrameCallback` quando disponível.
- Deve funcionar no **Chrome para Android** e no **Safari para iOS** (atenção às restrições do iOS: `playsinline`, autoplay mudo e reinício do wake lock ao voltar para a aba).
- Hospedagem estática (GitHub Pages, Netlify ou Vercel).
- Um app nativo (Flutter ou React Native) fica **fora do escopo da v1**. A arquitetura deve permitir migrar depois, mantendo a lógica de contagem isolada.

---

## 5. Calibração (feita uma vez por posição da câmera)

### 5.1 Retificação da perspectiva (homografia)

Vista de cima e em ângulo, a piscina aparece em perspectiva: as raias convergem. Para medir distâncias e separar as raias corretamente:

1. O usuário toca **4 pontos** na imagem:
   - P1 e P2: os cantos esquerdo e direito da **parede** (ou as bordas das raias extremas que ele quer monitorar), sobre a linha da parede;
   - P3 e P4: os pontos correspondentes numa linha **paralela à parede, a uma distância conhecida**. Boas referências são a linha das bandeirinhas de costas (5 m) ou a mudança de cor das boias das raias.
2. O usuário informa essa distância (padrão: **5 m**), e também o **número de raias** dentro da área e a **largura da raia** (padrão: 2,5 m).
3. O app calcula a **homografia** da imagem para um plano visto de cima, em metros: eixo X na largura das raias e eixo Y como a distância até a parede.
4. A **zona monitorada** vai de 0 m (parede) até uma distância configurável (padrão: **8 m**; ela pode passar dos pontos P3 e P4 por extrapolação).
5. As **divisórias das raias** nascem igualmente espaçadas no plano retificado, e o usuário pode ajustar cada uma arrastando.
6. Sobrepor na imagem ao vivo a grade retificada (as raias e as linhas de 2 em 2 m), para o usuário confirmar se ficou alinhado.

Salvar a calibração com um nome ("Raias 1–6, tripé lado sul"), para reaproveitar.

### 5.2 Calibração do ruído

Ao iniciar, o app pede **5 segundos com a área sem nadadores, se possível**, para aprender o nível normal de ondas e reflexos de cada raia. Depois disso, esse nível continua se adaptando devagar, mas só quando a raia está "vazia".

---

## 6. Detecção e rastreamento (núcleo do sistema)

### 6.1 Pipeline por quadro (de 10 a 15 fps)

1. Capturar o quadro e reduzir a resolução de processamento (cerca de 320 px de largura).
2. **Retificar** a área monitorada para uma grade fixa, por exemplo 10 px por metro (uma raia de 2,5 m por 8 m vira 25 × 80 px).
3. **Máscara de movimento**: subtração de fundo com média móvel ou mistura de gaussianas simplificada, mais limiar adaptativo por raia.
   - Ondas e reflexos geram ruído espalhado; o nadador gera uma **mancha concentrada**, com respingos e braçadas.
   - Aplicar morfologia (abertura e fechamento) e filtro temporal (média de 3 a 5 quadros).
4. Para cada raia, calcular o **perfil longitudinal**: quanto movimento existe em cada faixa de distância da parede (por exemplo, a cada 0,5 m).
5. Estimar a **posição do nadador** na raia: o centróide do maior grupo de movimento acima do limiar, em metros a partir da parede. Se nenhum grupo passar do limiar, a posição fica "nenhum".

### 6.2 Máquina de estados da raia (contagem)

Estados por raia, usando a posição `d` (em metros até a parede) suavizada:

```
VAZIA ──(nadador aparece no fundo da zona, d > 5 m)──▶ APROXIMANDO
APROXIMANDO ──(d diminui e chega a d < 2,5 m, OU some com d < 3 m)──▶ NA_PAREDE
NA_PAREDE ──(reaparece afastando-se, d aumentando e > 3 m)──▶ AFASTANDO   → CONTA +1
NA_PAREDE ──(fica parado perto da parede > X s)──▶ DESCANSANDO      → CONTA +1 (uma vez)
DESCANSANDO ──(sai afastando-se)──▶ AFASTANDO  (não conta de novo)
AFASTANDO ──(sai da zona, d > 8 m, ou some)──▶ VAZIA
```

Regras:

- **Contar uma única vez por ciclo** de aproximação e retorno. O momento recomendado para registrar é a entrada em `NA_PAREDE`; se a confirmação vier depois, com o afastamento, usar o horário da chegada para calcular a parcial.
- **Virada olímpica:** o nadador some com `d < 3 m` e reaparece afastando-se, entre 2 e 10 m. Isso precisa contar normalmente. Prever até **~4 s de desaparecimento** debaixo d'água; o valor deve ser configurável.
- **Virada simples ou toque com descanso:** o nadador fica visível e parado junto à parede. Conta uma vez e só rearma depois de ele se afastar.
- **Quem desiste no meio** (aproxima-se e volta antes de chegar a 2,5 m) não conta.
- **Intervalo mínimo** entre contagens na mesma raia (padrão: 20 s, configurável) é a última proteção contra contagem dupla.
- Usar a **direção do movimento** (sinal de `Δd` ao longo de cerca de 1 s) para distinguir aproximação de afastamento. Isso é o que torna a detecção robusta.
- Movimento que **não percorre a zona** (alguém parado na borda, mão de professor, boia mexendo) não pode contar.

### 6.3 Interferência entre raias

- Respingos atravessam as boias. Ignorar o movimento a menos de ~0,3 m da divisória, ou reduzir o peso dele.
- Se duas raias vizinhas dispararem ao mesmo tempo com intensidades muito diferentes, considerar só a mais forte.

### 6.4 Fase 2, opcional: detecção de pessoas com IA

Deixar uma interface `Detector` plugável para, no futuro, trocar ou complementar a detecção de movimento por um modelo de detecção de pessoas (MediaPipe Object Detector, YOLOv8n/YOLO11n em ONNX Runtime Web ou TF.js), com rastreamento (SORT ou ByteTrack). Isso permitiria **contar por nadador** quando houver mais de um na raia. Não é requisito da v1.

---

## 7. Interface

### Tela principal (modo contagem)

- O vídeo ao vivo ocupa a parte de cima, com sobreposição:
  - os contornos das raias, já em perspectiva;
  - a posição detectada de cada nadador (um ponto ou barra), com uma cor por estado (aproximando / na parede / afastando);
  - a contagem de cada raia sobre ela.
- Abaixo, um cartão por raia com o número de chegadas (bem grande), os metros, a última parcial, o estado atual e os botões **+1 / −1** para correção manual.
- Botões **Iniciar / Pausar** e **Zerar**, este último com confirmação por toque duplo, nunca `confirm()`.
- Bipe ou vibração a cada contagem, configurável. Opcionalmente, falar a contagem por voz (`speechSynthesis`), por exemplo "Raia 3, 400 metros".
- **Modo tela escura:** o vídeo é ocultado e só os números aparecem, em fonte grande, para economizar bateria e ler de longe.

### Configurações

Comprimento da piscina, número de raias, numeração das raias (da esquerda para a direita ou o contrário), regra de início (outra ponta ou lado da câmera), tamanho da zona monitorada, sensibilidade, tempo máximo submerso na virada, intervalo mínimo, bipe/voz.

### Histórico

Lista de sessões com data, duração, metros por raia e parciais. Exportar em **CSV**.

---

## 8. Modo de teste com vídeo gravado (obrigatório)

Essencial para calibrar sem estar na piscina:

- Permitir **abrir um arquivo de vídeo** (mp4/mov) no lugar da câmera e rodar o mesmo pipeline sobre ele, em tempo real ou acelerado (2×, 4×, o mais rápido possível).
- Permitir salvar um arquivo de **"gabarito"** (JSON com os horários reais das chegadas por raia, marcados à mão por botões durante a reprodução) e comparar com a detecção: **acertos, falsos positivos e chegadas perdidas**.
- **Modo depuração:** mostrar a máscara de movimento retificada, o perfil por raia e o estado da máquina de estados em tempo real.

---

## 9. Limitações aceitas na v1

- Mais de um nadador na mesma raia: a contagem soma as chegadas de todos. Documentar isso na interface.
- Chuva, sol direto ou reflexo muito forte podem gerar falsos positivos. A sensibilidade é ajustável.
- O celular não pode se mover depois da calibração. Opcional: detectar que a câmera se moveu (mudança grande na imagem inteira) e avisar.

---

## 10. Requisitos não funcionais

- Funcionar por **pelo menos 2 horas** seguidas sem travar e sem vazamento de memória: reutilizar buffers e evitar alocar arrays a cada quadro.
- Processamento **≤ 30 ms por quadro** num Android intermediário; se ficar abaixo de 8 fps, reduzir a resolução automaticamente.
- **Manter a tela ligada** (Wake Lock), reativando o bloqueio ao voltar para o app.
- Se a aba for recarregada ou fechada por acidente, **restaurar a sessão em andamento** (contagens e calibração).
- Interface em **português (pt-BR)**, legível sob o sol, com fonte grande, alto contraste e botões grandes (dedos molhados).
- Todo o processamento fica **no aparelho**; nenhum vídeo é enviado para servidor.

---

## 11. Estrutura sugerida

```
src/
  main.ts              # bootstrap, UI
  camera.ts            # getUserMedia / fonte de vídeo de arquivo
  calibration/
    homography.ts      # cálculo da homografia (4 pontos) + warp
    calibrationUI.ts   # toques nos 4 pontos, ajuste de divisórias
  vision/
    worker.ts          # Web Worker de processamento
    motion.ts          # subtração de fundo, máscara, morfologia
    laneProfile.ts     # perfil longitudinal e posição por raia
    detector.ts        # interface Detector (motion | ml futuro)
  counting/
    laneStateMachine.ts# máquina de estados + regras de contagem
    distance.ts        # regra de metros
  storage/
    sessions.ts        # persistência, histórico, CSV
  test/
    replay.ts          # modo vídeo gravado + gabarito
tests/
  laneStateMachine.test.ts  # testes unitários com sequências sintéticas de posições
```

**Testes unitários** da máquina de estados com sequências sintéticas de `d(t)`, cobrindo pelo menos: chegada normal; virada olímpica (some 2 s e volta); descanso de 30 s na parede; nadador que desiste a 4 m; respingo isolado; dois nadadores em sequência; virada muito rápida dentro do intervalo mínimo.

---

## 12. Marcos de entrega

1. **M1:** câmera e fonte de vídeo de arquivo, calibração por 4 pontos com homografia e grade sobreposta.
2. **M2:** máscara de movimento retificada, perfil e posição por raia, modo depuração.
3. **M3:** máquina de estados com testes unitários, contagem, distância e interface de contagem.
4. **M4:** modo de teste com gabarito e métricas; ajuste dos parâmetros padrão com vídeos reais.
5. **M5:** PWA instalável, wake lock, persistência, histórico com CSV, modo tela escura, voz.

## 13. Critérios de aceite

- Num vídeo de teste com 1 nadador por raia, incluindo viradas olímpicas e simples: **≥ 95% das chegadas detectadas** e **≤ 1 falso positivo a cada 40 chegadas**.
- Descanso na parede de até 2 min conta **apenas uma vez**.
- O app roda por 2 h no celular sem travar e sem apagar a tela.
- A calibração de 6 raias é feita em **menos de 1 minuto**.

## 14. Referência

O protótipo `prototipo/index.html` (detecção de movimento só na faixa da parede, divisórias arrastáveis, cartões por raia, wake lock, bipe e correção ±1) serve como referência de interface e de comportamento básico. A lógica de detecção deve ser **substituída** pela abordagem de zona do terço final com rastreamento de aproximação e afastamento descrita acima.