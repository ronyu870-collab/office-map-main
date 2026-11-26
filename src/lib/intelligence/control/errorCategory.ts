/** Stable server codes only; never classify or expose supplier error text. */
export function errorCategory(code:string) {
  const key=code.toLowerCase();
  if(/budget|token_reservation|cost_reservation|actual_token|actual_cost|attempt_limit|global_daily|global_monthly|provider_daily|provider_monthly|model_daily|model_monthly|test_daily|account_admission/.test(key))return 'budget';
  if(/invalid_configuration|not_configured|admission_service_unavailable/.test(key))return 'configuration';
  if(/denied|not_granted|disclosure|authorization|permission|rejected/.test(key))return 'security';
  if(/cancel/.test(key))return 'cancelled';
  if(/unauthorized|payment_required|model_not_found|rate_limited|timeout|provider_unavailable|invalid_response|stream_interrupted/.test(key))return 'provider';
  if(/tool/.test(key))return 'tool';
  if(/query|snapshot|source|artifact|file|chart|xlsx|result|audit|recovery/.test(key))return 'data';
  if(/agent|round|progress|protocol/.test(key))return 'agent';
  return 'unknown';
}
