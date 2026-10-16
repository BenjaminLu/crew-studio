// Studio's reviewed Taiwan -> Mainland wording for the 简体中文 UI. zh-CN text is
// derived from the zh-TW text: these terms first (longest match wins, one pass, so a
// result is never converted again), then OpenCC's character table (zh-cn-chars.js).
//   terms:     Traditional (Taiwan) term -> Mainland Simplified term. Only words whose
//              Mainland usage differs; a plain character change needs no entry here.
//   overrides: an exact zh-TW string -> the zh-CN string to show instead, for a whole
//              line the derivation gets wrong. Code can also pass a third argument,
//              T(en, zhTW, zhCN), or a server object can carry its own "zh-CN" field.
// Left out on purpose (Mainland usage is the same or the word is ambiguous here):
// 執行 (执行 is fine), 複製 (复制), 啟用 (启用), 資料 (资料 can mean materials),
// 程序 (procedure, not only process), 指標 (indicator), 宣告, 套件 (packs), 憑證.
window.crewZhTerms = {
  terms: {
    // accounts and sign-in
    "登入": "登录", "登出": "退出登录", "帳號": "账号", "帳戶": "账户", "使用者": "用户", "使用者名稱": "用户名",
    "金鑰": "密钥", "權杖": "令牌", "存取": "访问",
    // files and storage
    "檔案": "文件", "檔名": "文件名", "副檔名": "扩展名", "資料夾": "文件夹", "文件": "文档", "儲存": "保存",
    "儲存庫": "仓库", "存放庫": "仓库", "資料庫": "数据库", "硬碟": "硬盘", "磁碟": "磁盘", "記憶體": "内存",
    "快取": "缓存", "匯入": "导入", "匯出": "导出", "載入": "加载", "上載": "上传", "原始檔": "源文件",
    "執行檔": "可执行文件", "設定檔": "配置文件", "捷徑": "快捷方式",
    // software and code
    "軟體": "软件", "硬體": "硬件", "韌體": "固件", "程式": "程序", "程式碼": "代码", "原始碼": "源代码",
    "函式": "函数", "變數": "变量", "物件": "对象", "陣列": "数组", "字串": "字符串", "字元": "字符",
    "位元": "比特", "位元組": "字节", "雜湊": "哈希", "迴圈": "循环", "執行緒": "线程", "佇列": "队列",
    "回傳": "返回", "傳回": "返回", "呼叫": "调用", "元件": "组件", "外掛": "插件", "擴充功能": "扩展",
    "內建": "内置", "相容": "兼容", "整合": "集成", "偵錯": "调试", "除錯": "调试", "最佳化": "优化",
    "演算法": "算法", "作業系統": "操作系统", "解除安裝": "卸载", "欄位": "字段", "叢集": "集群",
    "伺服器": "服务器", "用戶端": "客户端", "終端機": "终端", "命令列": "命令行", "批次": "批量",
    // networks
    "網路": "网络", "連線": "连接", "連結": "链接", "遠端": "远程", "本機": "本地", "位址": "地址",
    "網域": "域名", "頻寬": "带宽", "逾時": "超时", "即時": "实时",
    // interface words
    "介面": "界面", "設定": "设置", "預設": "默认", "預設值": "默认值", "開啟": "打开", "檢視": "查看",
    "建立": "创建", "新增": "添加", "停用": "禁用", "套用": "应用", "重新整理": "刷新", "點選": "点击",
    "貼上": "粘贴", "剪下": "剪切", "剪貼簿": "剪贴板", "選單": "菜单", "視窗": "窗口", "分頁": "标签页",
    "頁籤": "标签页", "對話方塊": "对话框", "核取方塊": "复选框", "圖示": "图标", "捲動": "滚动",
    "游標": "光标", "螢幕": "屏幕", "滑鼠": "鼠标", "進階": "高级", "互動": "交互", "支援": "支持",
    "搜尋": "搜索", "訊息": "消息", "資訊": "信息", "收件匣": "收件箱", "回饋": "反馈", "工作階段": "会话",
    "範本": "模板", "範例": "示例", "專案": "项目", "裝置": "设备", "行動裝置": "移动设备",
    // media
    "影片": "视频", "視訊": "视频", "音訊": "音频", "縮圖": "缩略图", "字型": "字体", "簡報": "演示文稿",
    "解析度": "分辨率", "列印": "打印", "品質": "质量", "傳送": "发送",
    // words this UI uses often (found by converting every zh-TW string in public/ and reading the result)
    "紀錄": "记录", "唯讀": "只读", "透過": "通过", "拖曳": "拖动", "身分": "身份", "連字號": "连字符", "重設": "重置",
    "指令": "命令", "一則": "一条", "線上": "在线", "快速鍵": "快捷键",
    "區網": "局域网", "偵測": "检测", "帳本": "账本", "位數碼": "位数字", "開檔": "打开文件",
    "簡易檢視": "简易视图", "詳細檢視": "详细视图", "流程圖檢視": "流程图视图",
  },
  overrides: {
  },
};
