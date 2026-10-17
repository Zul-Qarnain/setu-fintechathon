# English ↔ Simplified Chinese Glossary (Draft)

Draft glossary — to be reviewed by a native Chinese speaker before publication

---

## Payments & FX

| # | English | 简体中文 | Pinyin | Note |
|---|---------|---------|--------|------|
| 1 | tuition | 学费 | xué fèi | Academic instruction fees paid to institution |
| 2 | dormitory fee | 住宿费 | zhù sù fèi | Housing fees for campus accommodation |
| 3 | fee notice | 缴费通知 | jiāo fèi tōng zhī | Official document detailing amount due and deadline |
| 4 | payee/beneficiary | 收款方 | shōu kuǎn fāng | Entity receiving payment funds |
| 5 | remittance | 汇款 | huì kuǎn | Cross-border money transfer from abroad |
| 6 | cross-border payment | 跨境支付 | kuàng jìng zhī fù | Payment between different jurisdictions |
| 7 | exchange rate | 汇率 | huì lǜ | Currency conversion rate |
| 8 | FX margin | 汇兑差额 | huì duì chā é | Difference between buy/sell rates or rate at transaction time |
| 9 | transfer fee | 手续费 | shǒu xù fèi | Bank/processor charge for executing transfer |
| 10 | remittance cost | 汇款成本 | huì kuǎn chéng běn | Total cost including fees and FX spread |
| 11 | financial inclusion | 金融普惠 | jīn róng pǔ huì | Access to affordable financial services for underserved populations |
| 12 | licensed payment institution | 持牌支付机构 | chí pái zhī fù jī gòu | Entity authorized by regulators to process payments |
| 13 | Setu never holds funds | Setu 不托管资金 | qiáo píng tái bù tuō guǎn zī jīn | Setu only prepares and checks payments; licensed partners move the money (sandbox only in this entry) |

---

## Student Obligations

| # | English | 简体中文 | Pinyin | Note |
|---|---------|---------|--------|------|
| 14 | family approver | 家庭审批人 | jiā tíng shěn pī rén | Parent/guardian who must approve large transactions |
| 15 | cooling-off period | 冷静期 | lěng jìng qī | Mandatory waiting period before a payment to a new or changed payee can be approved (24 h in Setu) |
| 16 | scholarship | 奖学金 | jiǎng xué jīn | Financial award reducing tuition burden |
| 17 | living allowance | 生活补助 | shēng huó bǔ zhù | Regular stipend for daily expenses |

---

## Banking & Channels in China

| # | English | 简体中文 | Pinyin | Note |
|---|---------|---------|--------|------|
| 18 | bank card | 银行卡 | yín háng kǎ | Debit or credit card linked to bank account |
| 19 | UnionPay | 银联 | yín lián | China's domestic card network (China UnionPay) |
| 20 | Alipay | 支付宝 | zhī fù bǎo | Third-party mobile payment platform owned by Alibaba |
| 21 | WeChat Pay | 微信支付 | wēi xìn zhī fù | Mobile payment service within WeChat app (Tencent) |
| 22 | SAFE (State Administration of Foreign Exchange) | 国家外汇管理局 | guó jiā wài huí guǎn lǐ jú | Regulates foreign exchange flows into/out of China |
| 23 | PBOC (People's Bank of China) | 中国人民银行 | zhōng guó rén mín yín xíng | Central bank; issues payment licenses |

---

## Security & Trust

| # | English | 简体中文 | Pinyin | Note |
|---|---------|---------|--------|------|
| 24 | sandbox (testing environment) | 沙箱 | shā xiāng | Isolated test environment mimicking production |
| 25 | KYC (Know Your Customer) | 客户身份识别 | kè hù shēn fèn shí bié | Process verifying user identity per regulations |
| 26 | AML (Anti-Money Laundering) | 反洗钱 | fǎn xǐ qián | Measures to detect/report suspicious transactions |
| 27 | two-factor authentication | 双因素认证 | shuāng yīn sù rèn zhèng | Login requires password + second factor (phone, token) |
| 28 | one-time password (TOTP) | 一次性密码 | yī cì xìng mì mǎ | Time-based 6-digit code that changes every 30 seconds (RFC 6238); each code is accepted once |
| 29 | audit log | 审计日志 | shěn jì rì zhì | Append-only record of system actions; Setu makes it tamper-evident with a hash chain |
| 30 | hash chain | 哈希链 | hā mì liàn | Cryptographic linkage of records preventing tampering |
| 31 | phishing | 钓鱼攻击 | diào yú gōng jī | Fraud attempt to steal credentials via fake sites/emails |
| 32 | scam | 诈骗 | zhà piàn | General term for financial fraud schemes |
| 33 | spoofing | 伪装攻击 | wěi zhuāng gōng jī | Impersonating trusted entity/domain to deceive users |
| 34 | risk tier | 风险等级 | fēng xiǎn děng jí | Classification based on transaction/user risk profile |

---

## Compliance & Data Protection

| # | English | 简体中文 | Pinyin | Note |
|---|---------|---------|--------|------|
| 35 | residence permit | 居留许可 | jū liú xǔ kě | Official document allowing foreigner to stay in China |
| 36 | student visa | 学生签证 | xué shēng qiān zhèng | X1/X2 visa issued for study purposes |
| 37 | consent | 同意 | tóng yì | User authorization for data processing under PIPL |
| 38 | erasure (right to deletion) | 删除权 | shān chú quán | Right to request data deletion under certain conditions |
| 39 | personal information | 个人信息 | gè rén xìn xī | Any info relating to identified/natural person (PIPL definition) |
| 40 | sensitive personal information | 敏感个人信息 | mǐn gǎn gè rén xìn xī | Data that could harm person if leaked (biometric, financial, etc.) |
| 41 | cross-border data transfer | 个人信息出境 | gè rén xìn xī chū jìng | Transferring personal data out of mainland China |
| 42 | data classification | 数据分级 | shù jù fēn jí | Categorizing data by sensitivity and regulatory requirements |
| 43 | encryption at rest | 静态加密 | jìng tài jiā mì | Encrypting data stored on disk or database |
| 44 | tokenisation | 令牌化 | lìng pái huà | Replacing sensitive data with non-sensitive surrogate value |
| 45 | access control | 访问控制 | fǎng wèn kòng zhì | Restricting system access based on roles/permissions |
| 46 | approval | 审批 | shěn pī | Required authorization step before transaction execution |
| 47 | payment limit | 支付限额 | zhī fù xiàn é | Maximum allowable transaction size per policy |
| 48 | idempotency | 幂等性 | mì děng xìng | Multiple identical requests produce same result as single request |
| 49 | PIPL (Personal Information Protection Law) | 《个人信息保护法》 | gè rén xìn xī bǎo hù fǎ | China's comprehensive data privacy law effective Nov 2021 |
| 50 | Data Security Law | 《数据安全法》 | shù jù ān quán fǎ | Law governing data handling security obligations effective Sept 2021 |

---

## AI Terms

| # | English | 简体中文 | Pinyin | Note |
|---|---------|---------|--------|------|
| 51 | deterministic | 确定性 | què dìng xìng | System behavior always same given same input |
| 52 | hallucination | 幻觉 | huàn jué | LLM generating false/confabulated outputs presented as fact |
| 53 | large language model (LLM) | 大语言模型 | dà yǔ yán mó xíng | AI trained on vast text corpora generating human-like text |
| 54 | guardrail | 安全围栏 | ān quán wéi lán | Controls preventing AI from generating harmful/inappropriate content |
| 55 | untrusted content | 不可信内容 | bù kě xìn nèi róng | Input/output that may be malicious, inaccurate, or harmful |
| 56 | prompt injection | 提示词注入 | tí shì cí zhù rù | Malicious input designed to override system instructions |
| 57 | synthetic data | 合成数据 | hé chéng shù jù | Artificially generated data mimicking real patterns without exposing real user data |
| 58 | offline mode | 离线模式 | lí xiàn mó shì | Runs on bundled sample data and a scripted planner with no network or API keys |
| 59 | sandboxed processing | 沙箱处理 | shā xiāng chǔ lǐ | AI processing executed in isolated environment to contain risks |
| 60 | audit trail for AI | AI 审计追踪 | AI shěn jì zhuī zōng | Complete record of AI interactions for compliance verification |

---

**Usage notes:**

- All Chinese terms follow standard Mainland China usage conventions
- Legal acronyms include official Chinese names where established
- Financial terms align with PBOC/SAFE regulatory terminology
- This glossary supports documentation, UI labels, and developer communication for Setu 桥
