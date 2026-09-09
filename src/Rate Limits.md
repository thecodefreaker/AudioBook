Rate Limits

Rate limits act as control measures to regulate how frequently users and applications can access our API within
specified timeframes. These limits help ensure service stability, fair access, and protection against misuse so that we
can serve reliable and fast inference for all.

Copy page

v

Understanding Rate Limits

Rate limits are measured in:

. RPM: Requests per minute
. RPD: Requests per day
. TPM: Tokens per minute
. TPD: Tokens per day
. ASH: Audio seconds per hour
. ASD: Audio seconds per day
. ITPM: Input tokens per minute
. OTPM: Output tokens per minute

Rate limits apply at the organization level, not individual users. You can hit any limit type depending on which
threshold you reach first.

Example: Let's say your RPM = 50 and your TPM = 200K. If you were to send 50 requests with only 100 tokens within
a minute, you would reach your limit even though you did not send 200K tokens within those 50 requests.

Input and Output Token Rate Limits (ITPM / OTPM)
In addition to the combined TPM limit, some organizations are also subject to separate per-minute limits on input
tokens (ITPM) and output tokens (OTPM). For example, an OTPM limit caps how many completion tokens your
organization can generate per minute, regardless of how many input tokens are sent.

If these limits are configured on your account, you'll see your TPM value on the Limits page - hover over it to see the
"X in / Y out" breakdown. If no breakdown appears, your organization has a single combined TPM cap with no
separate input/output limits.

Rate Limits

The following is a high level summary and there may be exceptions to these limits. You can view the current, exact

Here is a structured extraction of the Free Plan Rate Limits shown in the screenshots.

Rate Limit Definitions
RPM = Requests Per Minute
RPD = Requests Per Day
TPM = Tokens Per Minute
TPD = Tokens Per Day
ASH = Audio Seconds Per Hour
ASD = Audio Seconds Per Day
Free Plan Limits
Model ID	RPM	RPD	TPM	TPD	ASH	ASDcanopylabs/orpheus-arabic-saudi	10	100	1.2K	3.6K	-	-
canopylabs/orpheus-v1-english	10	100	1.2K	3.6K	-	-
groq/compound	30	250	70K	-	-	-
groq/compound-mini	30	250	70K	-	-	-
llama-3.1-8b-instant	30	14.4K	6K	500K	-	-
llama-3.3-70b-versatile	30	1K	12K	100K	-	-
meta-llama/llama-prompt-guard-2-22m	30	14.4K	15K	500K	-	-
meta-llama/llama-prompt-guard-2-86m	30	14.4K	15K	500K	-	-
openai/gpt-oss-120b	30	1K	8K	200K	-	-
openai/gpt-oss-20b	30	1K	8K	200K	-	-
openai/gpt-oss-safeguard-20b	30	1K	8K	200K	-	-
qwen/qwen3-27b	30	1K	8K	200K	-	-
whisper-large-v3	20	2K	-	-	7.2K	28.8K
whisper-large-v3-turbo	20	2K	-	-	7.2K	28.8K
Quick Summary by Category
Text Generation Models
Model Family	RPM	RPD	TPMGroq Compound / Compound Mini	30	250	70K
Llama 3.1 8B Instant	30	14.4K	6K
Llama 3.3 70B Versatile	30	1K	12K
GPT-OSS (120B, 20B, Safeguard)	30	1K	8K
Qwen 3 27B	30	1K	8K
Prompt Guard Models
Model	RPM	RPD	TPM	TPDPrompt-Guard-2-22M	30	14.4K	15K	500K
Prompt-Guard-2-86M	30	14.4K	15K	500K
Speech-to-Text Models
Model	RPM	RPD	ASH	ASDWhisper Large v3	20	2K	7.2K	28.8K
Whisper Large v3 Turbo	20	2K	7.2K	28.8K
Highest Limits Observed
Highest TPM: Groq Compound / Compound Mini (70K TPM)
Highest RPD: Llama 3.1 8B Instant & Prompt Guard models (14.4K RPD)
Highest TPD: Llama 3.1 8B Instant & Prompt Guard models (500K TPD)
Audio Models: Whisper Large v3 and Whisper Large v3 Turbo support 7.2K audio seconds/hour and 28.8K audio seconds/day.

This should be suitable for documentation, reporting, or comparison purposes.


Here is the structured extraction from the additional screenshots.

Rate Limit Headers

These HTTP response headers provide information about current usage, remaining quota, and reset times.

Header	Example Value	Descriptionretry-after	2	Time (in seconds) to wait before retrying a request after hitting a rate limit.
x-ratelimit-limit-requests	14400	Total allowed Requests Per Day (RPD).
x-ratelimit-limit-tokens	18000	Total allowed Tokens Per Minute (TPM).
x-ratelimit-remaining-requests	14370	Remaining Requests Per Day (RPD).
x-ratelimit-remaining-tokens	17997	Remaining Tokens Per Minute (TPM).
x-ratelimit-reset-requests	2m59.56s	Time until request quota resets. Refers to RPD.
x-ratelimit-reset-tokens	7.66s	Time until token quota resets. Refers to TPM.
Header Categories
Request-Based Limits
Header	Purposex-ratelimit-limit-requests	Maximum requests allowed
x-ratelimit-remaining-requests	Requests remaining
x-ratelimit-reset-requests	Time until request counter resets
Token-Based Limits
Header	Purposex-ratelimit-limit-tokens	Maximum tokens allowed
x-ratelimit-remaining-tokens	Tokens remaining
x-ratelimit-reset-tokens	Time until token counter resets
Retry Management
Header	Purposeretry-after	Number of seconds to wait before submitting another request after being rate limited
Handling Rate Limits

When rate limits are exceeded, the API returns:

HTTP/1.1 429 Too Many Requests

Important Notes
retry-after is returned only when a rate limit has been exceeded and a 429 Too Many Requests response is generated.
All other rate-limit headers are included in normal responses to help monitor usage.
Request limits are measured using RPD (Requests Per Day).
Token limits are measured using TPM (Tokens Per Minute).
Example Response Headers
x-ratelimit-limit-requests: 14400
x-ratelimit-remaining-requests: 14370
x-ratelimit-reset-requests: 2m59.56s

x-ratelimit-limit-tokens: 18000
x-ratelimit-remaining-tokens: 17997
x-ratelimit-reset-tokens: 7.66s

Recommended Client Logic
Monitor x-ratelimit-remaining-* values.
If remaining quota is low, throttle requests.
If a 429 Too Many Requests response is received:
Read the retry-after header.
Wait for the specified duration.
Retry the request.
Use the reset headers to predict when capacity becomes available again.

This provides a complete reference for both the model-specific rate limits and the runtime rate-limit headers exposed by the API.Rate