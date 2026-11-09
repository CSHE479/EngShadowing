// 聽寫題庫：由易到難排列，每天依序出 3 題，全部做完會從頭循環。
// [英文, 中文, [[單字, 音標, 中文], ...], 聽力小提示]
const DICT_LEVELS = [["第 1 級", 10], ["第 2 級", 10], ["第 3 級", 10]];
const DICTATION = [
  // 第 1 級：3 到 4 個字
  ["I am happy.","我很開心。",[["happy","ˈhæpi","開心的"]],"I am 口語常連在一起，聽起來像 I'm。"],
  ["It is hot.","天氣很熱。",[["hot","hɑːt","熱的"]],"It is 連讀時像 ih-tiz，is 很輕。"],
  ["I like tea.","我喜歡茶。",[["tea","tiː","茶"]],"like 的 k 很短，後面馬上接 tea。"],
  ["She is nice.","她人很好。",[["nice","naɪs","親切的"]],"she 的開頭是 sh 音，不是 s。"],
  ["We go home.","我們回家。",[["home","hoʊm","家"]],"go home 不加 to，這是固定用法。"],
  ["He has a dog.","他有一隻狗。",[["dog","dɔːɡ","狗"]],"a 非常輕，很容易漏聽。has a 會連成 ha-za。"],
  ["I see a cat.","我看到一隻貓。",[["cat","kæt","貓"]],"cat 的 t 在句尾可能幾乎聽不到。"],
  ["Open the door.","請開門。",[["open","ˈoʊpən","打開"],["door","dɔːr","門"]],"the 很輕，要靠句型補上：動詞後面常接 the。"],
  ["Sit down, please.","請坐下。",[["sit","sɪt","坐"],["down","daʊn","向下"]],"Sit down 的 t 和 d 黏在一起，只聽到一個音。"],
  ["Good morning, teacher.","老師早安。",[["morning","ˈmɔːrnɪŋ","早上"],["teacher","ˈtiːtʃər","老師"]],"Good morning 的 d 常常不會完整念出來。"],
  // 第 2 級：4 到 5 個字
  ["I drink water every day.","我每天喝水。",[["drink","drɪŋk","喝"],["every","ˈevri","每一"]],"every 只有兩個音節，聽起來像 ev-ri。"],
  ["My mother is at home.","我媽媽在家。",[["mother","ˈmʌðər","媽媽"]],"is at 連讀成 i-zat。"],
  ["I have two brothers.","我有兩個兄弟。",[["brothers","ˈbrʌðərz","兄弟"]],"注意字尾的 s，兩個以上要加 s。"],
  ["We eat lunch at noon.","我們中午吃午餐。",[["lunch","lʌntʃ","午餐"],["noon","nuːn","中午"]],"lunch at 連讀成 lun-chat。"],
  ["She works in a hospital.","她在醫院工作。",[["works","wɜːrks","工作"],["hospital","ˈhɑːspɪtl","醫院"]],"she 後面的動詞要加 s。in a 連讀成 i-na。"],
  ["It is very cold today.","今天非常冷。",[["very","ˈveri","非常"],["cold","koʊld","冷的"]],"very 開頭是 v，上排牙齒碰下唇。"],
  ["Where is my phone?","我的手機在哪裡？",[["where","wer","哪裡"],["phone","foʊn","手機"]],"Where is 常連成 Where's。"],
  ["I want some rice.","我想要一些飯。",[["some","sʌm","一些"],["rice","raɪs","米飯"]],"want some 的 t 幾乎聽不到。"],
  ["He goes to school.","他去上學。",[["goes","ɡoʊz","去"],["school","skuːl","學校"]],"to 會弱讀成 tə，很輕。he 後面要用 goes。"],
  ["Please close the window.","請關窗。",[["close","kloʊz","關上"],["window","ˈwɪndoʊ","窗戶"]],"close 當動詞時，字尾是 z 音。"],
  // 第 3 級：5 到 7 個字
  ["I go to work by bus.","我搭公車上班。",[["work","wɜːrk","工作"],["bus","bʌs","公車"]],"by bus 不加 the，交通方式的固定說法。"],
  ["Can you help me, please?","可以請你幫我嗎？",[["help","help","幫忙"]],"Can you 會連成 kə-nyu，can 很輕。"],
  ["What time is it now?","現在幾點？",[["time","taɪm","時間"]],"is it 連讀成 i-zit。"],
  ["I don't like coffee.","我不喜歡咖啡。",[["coffee","ˈkɔːfi","咖啡"]],"don't 的 t 很輕，要靠語氣聽出否定。"],
  ["We are going to the park.","我們要去公園。",[["going","ˈɡoʊɪŋ","去"],["park","pɑːrk","公園"]],"We are 常縮成 We're，聽起來很短。"],
  ["The bank is next to the store.","銀行在商店旁邊。",[["bank","bæŋk","銀行"],["next","nekst","旁邊的"]],"next to 的 t 黏在一起，只聽到一個 t。"],
  ["She is reading a book.","她正在看書。",[["reading","ˈriːdɪŋ","閱讀"],["book","bʊk","書"]],"reading a 連讀成 ree-ding-a。"],
  ["My brother lives in Taipei.","我哥哥住在台北。",[["lives","lɪvz","居住"]],"lives in 連讀成 liv-zin。"],
  ["I will call you tonight.","我今晚會打給你。",[["call","kɔːl","打電話"],["tonight","təˈnaɪt","今晚"]],"I will 常縮成 I'll，聽起來像 all。"],
  ["Do you want to eat now?","你現在想吃東西嗎？",[["want","wɑːnt","想要"],["eat","iːt","吃"]],"want to 口語常念成 wanna，寫的時候要寫 want to。"],
];
