/**
 * dsh-credits — browser half (lazy-CJS 客户端 bundle)。
 *
 * 在 `conversation.composer.dock`(输入框下方统计条所在行) 注册余额读数:
 *   - 余额: 单例轮询器按服务器下发的 `clientPollIntervalMs` 读取 `/query-credits`
 *     (只读缓存, 不直接访问 DeepSeek); 页面隐藏时暂停轮询。
 *   - 本会话消耗 / TPS: 读取宿主推送的 `queryCreditsCost` 与 `liveTokenUsage` 投影。
 *   - 设置: 注册一级 `settings.section`(展示 / 额度查询 / 阈值 / 单价 / YAML 多张可折叠卡片)。
 *     每张独立「未保存 / 放弃修改 / 保存」，字段有「已覆盖 / 恢复默认」；关掉再回来草稿仍在。
 *
 * 额度按 DSH 供应商独立绑定；切换当前模型供应商时读取对应的 providerQuotaMap。
 */
window.__ModuleLoader__.load({
	id: "dsh-credits",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region styles
		const CSS_ID = "dsh-credits/styles.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + CSS_ID + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-credits";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				"@keyframes dshqb-pulse{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.4);opacity:1}}",
				"@keyframes dshqb-fadein{from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)}}",
				"@keyframes dshqb-toast-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",
				".dshqb_root{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:auto;max-width:none;padding:4px 0 0;margin:0;color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-size:12px;line-height:20px;overflow:visible;flex:0 0 auto;order:1}",
				"[data-dshqb-dock][data-dshqb-layout='own']{display:flex;flex:0 0 100%;width:100%;max-width:100%;justify-content:center}",
				"div[data-slot='conversation.composer.dock']:has([data-dshqb-dock][data-dshqb-layout='own']){display:flex !important;flex-direction:row;flex-wrap:wrap !important;align-items:center;justify-content:center;width:100%;box-sizing:border-box}",
				"div[data-slot='conversation.composer.dock']:has([data-dshqb-dock][data-dshqb-layout='shared']){display:flex !important;flex-direction:row;flex-wrap:nowrap;align-items:center;justify-content:center;width:100%;box-sizing:border-box}",
				"div[data-slot='conversation.composer.dock'] > *:not([role='tooltip']):not([data-dshqb-dock]):not([data-dsh-live-tps]):has(+ [data-dshqb-dock][data-dshqb-layout='shared'], + [role='tooltip'] + [data-dshqb-dock][data-dshqb-layout='shared']){width:auto;max-width:620px;min-width:0;margin:0;padding:4px 0 0;flex:0 1 auto}",
				"div[data-slot='conversation.composer.dock'] > *:has(> [data-dshqb-dock][data-dshqb-layout='own']){flex:0 0 100%;width:100%;max-width:100%}",
				"div[data-slot='conversation.composer.dock'] > *:has(> [data-dshqb-dock][data-dshqb-layout='shared']){flex:0 0 auto;width:auto}",
				"div[data-slot='conversation.composer.dock'] > * + [data-dshqb-dock][data-dshqb-layout='shared']::before{content:'·';color:var(--dsw-alias-separator-primary,var(--dsw-alias-border-l3,rgba(128,128,128,0.25)));margin:0 10px}",
				".dshqb_sep{display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-separator-primary,var(--dsw-alias-border-l3,rgba(128,128,128,0.25)));margin:0 10px;user-select:none}",
				".dshqb_trigger{position:relative;display:inline-flex;align-items:center;cursor:default}",
				".dshqb_amount{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;display:inline-flex;align-items:center}",
				".dshqb_error{color:var(--dsw-alias-state-error-primary,#ef4444);display:inline-flex;align-items:center}",
				".dshqb_dot{display:block;width:7px;height:7px;border-radius:50%;margin-right:6px;flex-shrink:0;transition:background-color .2s ease,box-shadow .2s ease,transform .2s ease}",
				".dshqb_dot_btn{cursor:pointer;border:none;padding:0;background:transparent;outline:none;display:inline-flex;align-items:center;justify-content:center;line-height:1}",
				".dshqb_dot_btn:hover{transform:scale(1.35)}",
				".dshqb_dot_btn:active{transform:scale(0.95)}",
				".dshqb_dot_loading{animation:dshqb-pulse .7s ease-in-out infinite}",
				".dshqb_dot_success{background-color:var(--dsw-alias-state-success-primary,#10b981);box-shadow:0 0 0 2px rgba(16,185,129,0.2)}",
				".dshqb_dot_warning{background-color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#f59e0b));box-shadow:0 0 0 2px rgba(245,158,11,0.2)}",
				".dshqb_dot_danger{background-color:var(--dsw-alias-state-error-primary,#ef4444);box-shadow:0 0 0 2px rgba(239,68,68,0.2)}",
				".dshqb_popover{position:absolute;bottom:calc(100% + 8px);left:50%;right:auto;z-index:9999;width:min(440px,calc(100vw - 24px));min-width:0;max-width:calc(100vw - 24px);background:var(--dsw-alias-bg-layer-1,var(--dsw-hovercard-bg,var(--dsw-alias-surface-elevated,#ffffff)));border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.2)));border-radius:10px;box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,0.18));padding:clamp(10px,3cqi,14px) clamp(10px,3.4cqi,16px);display:flex;flex-direction:row;flex-wrap:wrap;align-items:stretch;gap:12px 16px;box-sizing:border-box;white-space:normal;text-align:left;color:var(--dsw-alias-label-primary);font-size:12px;font-size:clamp(11px,2.8cqi,12px);line-height:1.5;backdrop-filter:blur(16px);opacity:0;pointer-events:none;transform:translateX(-50%) translateY(6px);transition:opacity .18s cubic-bezier(0.16,1,0.3,1),transform .18s cubic-bezier(0.16,1,0.3,1);container-type:inline-size;container-name:dshqb-pop}",
				".dshqb_popover::after{content:'';position:absolute;top:100%;left:0;right:0;height:12px;background:transparent}",
				".dshqb_trigger:hover .dshqb_popover, .dshqb_popover:hover{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0)}",
				".dshqb_col{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}",
				".dshqb_popover .dshqb_col{flex:1 1 188px}",
				".dshqb_vsep{width:1px;background:var(--dsw-alias-separator-primary,var(--dsw-alias-border-l3,rgba(128,128,128,0.15)));align-self:stretch;margin:0 2px;flex:0 0 1px}",
				"@container dshqb-pop (max-width:400px){.dshqb_vsep{display:none}.dshqb_popover .dshqb_col{flex:1 1 100%}}",
				".dshqb_card_header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;font-weight:600;font-size:12px;font-size:clamp(11px,2.8cqi,12px);color:var(--dsw-alias-label-secondary)}",
				".dshqb_card_title{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				".dshqb_card_badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-size:clamp(10px,2.4cqi,11px);font-weight:500;line-height:14px;flex-shrink:0;white-space:nowrap}",
				".dshqb_card_badge_btn{cursor:pointer;border:none;font:inherit;font-size:11px;font-weight:500;line-height:14px}",
				".dshqb_card_badge_btn:hover{filter:brightness(1.12)}",
				".dshqb_card_badge_btn:disabled{cursor:wait;opacity:.7}",
				".dshqb_card_badge_success{background:rgba(16,185,129,0.12);color:var(--dsw-alias-state-success-primary,#10b981)}",
				".dshqb_card_badge_warning{background:rgba(245,158,11,0.12);color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#f59e0b))}",
				".dshqb_card_badge_danger{background:rgba(239,68,68,0.12);color:var(--dsw-alias-state-error-primary,#ef4444)}",
				".dshqb_card_badge_info{background:rgba(59,130,246,0.12);color:var(--dsw-alias-brand-primary,#3b82f6)}",
				".dshqb_card_badges{display:inline-flex;align-items:center;justify-content:flex-end;gap:6px;min-width:0;flex-shrink:0}",
				".dshqb_tariff_badge{appearance:none;border:0;font:inherit;cursor:pointer}",
				".dshqb_tariff_peak{background:rgba(245,158,11,0.14);color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#f59e0b))}",
				".dshqb_tariff_offpeak{background:rgba(16,185,129,0.14);color:var(--dsw-alias-state-success-primary,#10b981)}",
				".dshqb_tariff_badge:hover{filter:brightness(1.12)}",
				".dshqb_hover_tip_wrap{position:relative;display:inline-flex;align-items:center;min-width:0}",
				".dshqb_hover_tip{position:absolute;left:50%;bottom:calc(100% + 8px);z-index:10020;width:max-content;max-width:min(420px,calc(100vw - 24px));padding:7px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));border-radius:7px;background:var(--dsw-alias-bg-layer-1,var(--dsw-hovercard-bg,#fff));box-shadow:var(--dsw-shadow-lv2,0 6px 18px rgba(0,0,0,.16));color:var(--dsw-alias-label-primary);font-size:11px;font-weight:400;line-height:1.5;text-align:left;white-space:pre-line;overflow-wrap:anywhere;opacity:0;pointer-events:none;transform:translate(-50%,4px);transition:opacity .15s ease,transform .15s ease}",
				".dshqb_hover_tip:after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--dsw-alias-bg-layer-1,var(--dsw-hovercard-bg,#fff))}",
				".dshqb_hover_tip_wrap:hover>.dshqb_hover_tip,.dshqb_hover_tip_wrap:focus-within>.dshqb_hover_tip{opacity:1;transform:translate(-50%,0)}",
				".dshqb_card_row{display:flex;align-items:baseline;justify-content:space-between;font-size:12px}",
				".dshqb_card_val_main{font-size:16px;font-size:clamp(13px,3.8cqi,16px);font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;flex-shrink:0;white-space:nowrap}",
				".dshqb_card_sub{font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;gap:8px}",
				".dshqb_card_models{margin:4px 0 0;padding:0;list-style:none;font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:2px}",
				".dshqb_card_models li{display:flex;justify-content:space-between;font-variant-numeric:tabular-nums}",
				".dshqb_card_hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary);margin-top:auto;padding-top:6px;border-top:1px dashed var(--dsw-alias-separator-primary,var(--dsw-alias-border-l3,rgba(128,128,128,0.15)));display:flex;flex-direction:column;gap:3px;min-width:0;white-space:normal;overflow-wrap:anywhere}",
				".dshqb_card_tokens{display:flex;flex-direction:column;gap:2px;font-size:10.5px;color:var(--dsw-alias-label-secondary);line-height:1.35}",
				".dshqb_card_hit{font-size:10px;color:var(--dsw-alias-label-tertiary);opacity:0.9}",
				".dshqb_wallets{display:flex;flex-direction:column;gap:8px}",
				".dshqb_wallet{border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.12));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.04));border-radius:6px;padding:6px 10px;display:flex;flex-direction:column;gap:4px}",
				".dshqb_wallet_head{display:flex;align-items:baseline;justify-content:space-between;font-size:11.5px}",
				".dshqb_wallet_code{font-weight:600;color:var(--dsw-alias-label-secondary)}",
				".dshqb_quota_rows{display:flex;flex-direction:column;gap:8px}",
				".dshqb_quota_row{border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.12));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.04));border-radius:6px;padding:6px 10px;display:flex;flex-direction:column;gap:4px}",
				".dshqb_quota_head{display:flex;align-items:baseline;justify-content:space-between;font-size:11.5px}",
				".dshqb_quota_name{font-weight:600;color:var(--dsw-alias-label-secondary)}",
				".dshqb_quota_pct{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:600}",
				".dshqb_quota_pct_btn{cursor:pointer;background:transparent;border:none;padding:0;font:inherit;font-variant-numeric:tabular-nums;color:inherit;font-weight:600}",
				".dshqb_quota_pct_btn:hover{text-decoration:underline}",
				".dshqb_quota_pct_btn:disabled{cursor:wait;opacity:.7}",
				".dshqb_quota_track{height:5px;border-radius:999px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,0.14));overflow:hidden}",
				".dshqb_quota_fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary,#10b981);transition:width .2s ease}",
				".dshqb_quota_fill_warning{background:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#f59e0b))}",
				".dshqb_quota_fill_danger{background:var(--dsw-alias-state-error-primary,#ef4444)}",
				".dshqb_quota_meta{display:flex;justify-content:space-between;font-size:10.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
				".dshqb_cap{position:fixed;z-index:10050;font-size:12px;color:var(--dsw-alias-label-primary);line-height:1.4;user-select:none;cursor:grab}",
				".dshqb_cap_pill{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.2));background:var(--dsw-alias-bg-layer-1,rgba(20,20,24,0.88));box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,0.18));backdrop-filter:blur(16px);font-variant-numeric:tabular-nums}",
				".dshqb_cap_panel{width:320px;max-width:92vw;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.2));background:var(--dsw-alias-bg-layer-1,rgba(20,20,24,0.94));box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,0.22));backdrop-filter:blur(16px);box-sizing:border-box;white-space:normal;overflow-wrap:anywhere}",
				".dshqb_cap_head{display:flex;align-items:center;justify-content:space-between;cursor:move;font-weight:600}",
				".dshqb_cap_chips{display:flex;flex-wrap:wrap;gap:6px}",
				".dshqb_cap_chip{border:1px solid rgba(128,128,128,0.28);background:rgba(255,255,255,0.08);color:var(--dsw-alias-label-secondary,#d4d4d8);border-radius:999px;padding:3px 9px;cursor:pointer;font-size:11px;font-family:inherit}",
				".dshqb_cap_chip_on{background:#007AFF;border-color:#007AFF;color:#fff}",
				".dshqb_cap_custom{display:flex;flex-direction:column;gap:6px}",
				".dshqb_cap_custom label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--dsw-alias-label-tertiary)}",
				".dshqb_host{position:fixed;width:0;height:0;overflow:visible;pointer-events:none;z-index:10050}",
				".dshqb_host .dshqb_cap{pointer-events:auto}",
				".dshqb_pricing_wrap{position:relative;display:inline-flex;align-items:center}",
				".dshqb_btn_icon{color:var(--dsw-alias-label-tertiary);display:inline-flex;align-items:center;justify-content:center;padding:2px 4px;border-radius:4px;text-decoration:none;line-height:1;background:transparent;border:none;cursor:pointer;transition:color .15s ease,background-color .15s ease,transform .15s ease}",
				".dshqb_btn_icon svg{display:block}",
				".dshqb_btn_icon:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,0.1));transform:scale(1.1)}",
				".dshqb_btn_icon:active{transform:scale(0.95)}",
				".dshqb_pricing_popover{position:absolute;bottom:calc(100% + 8px);left:50%;right:auto;z-index:9999;width:min(320px,calc(100vw - 24px));min-width:0;max-width:calc(100vw - 24px);background:var(--dsw-alias-bg-layer-1,var(--dsw-hovercard-bg,var(--dsw-alias-surface-elevated,#ffffff)));border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.2)));border-radius:10px;box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,0.18));padding:12px 14px;display:flex;flex-direction:column;gap:8px;box-sizing:border-box;white-space:normal;text-align:left;color:var(--dsw-alias-label-primary);font-size:12px;font-size:clamp(11px,3.4cqi,12px);line-height:1.5;backdrop-filter:blur(16px);opacity:0;pointer-events:none;transform:translateX(-50%) translateY(6px);transition:opacity .18s cubic-bezier(0.16,1,0.3,1),transform .18s cubic-bezier(0.16,1,0.3,1);container-type:inline-size}",
				".dshqb_pricing_popover::after{content:'';position:absolute;top:100%;left:0;right:0;height:12px;background:transparent}",
				".dshqb_pricing_wrap:hover .dshqb_pricing_popover, .dshqb_pricing_popover:hover{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0)}",
				".dshqb_pricing_models{display:flex;flex-direction:column;gap:6px}",
				".dshqb_pricing_card_item{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.06));border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.12));border-radius:6px;padding:6px 10px;display:flex;flex-direction:column;gap:3px}",
				".dshqb_pricing_model_name{font-weight:600;font-size:12px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
				".dshqb_pricing_rates{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}",
				".dshqb_pricing_dot{color:var(--dsw-alias-separator-primary,var(--dsw-alias-border-l3,rgba(128,128,128,0.3)))}",
				".dshqb_pricing_link{color:var(--dsw-alias-brand-primary,var(--dsw-alias-accent-primary,#3b82f6));text-decoration:none;font-size:11px;display:inline-flex;align-items:center;margin-top:2px}",
				".dshqb_pricing_link:hover{text-decoration:underline}",
				/* Modal & Settings Styles */
				".dshqb_modal_backdrop{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,0.5));backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;animation:dshqb-fadein .18s ease-out}",
				".dshqb_modal{background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#ffffff));border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-primary,rgba(128,128,128,0.2)));border-radius:14px;box-shadow:var(--dsw-shadow-lv3,0 24px 64px rgba(0,0,0,0.25));width:580px;max-width:96vw;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;box-sizing:border-box;animation:dshqb-fadein .18s ease-out;white-space:normal}",
				".dshqb_modal_header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 20px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.03));border-bottom:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.12)));font-size:15px;font-weight:600}",
				".dshqb_modal_close{background:transparent;border:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:18px;line-height:1;padding:4px 8px;border-radius:6px;transition:all .15s ease}",
				".dshqb_modal_close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,0.1))}",
				".dshqb_modal_tabs{display:flex;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.04));padding:4px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.12)));gap:4px;overflow-x:auto}",
				".dshqb_modal_tab{padding:8px 14px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;font-weight:500;cursor:pointer;border-radius:6px 6px 0 0;border-bottom:2px solid transparent;transition:all .15s ease;white-space:nowrap}",
				".dshqb_modal_tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,0.06))}",
				".dshqb_modal_tab_active{color:var(--dsw-alias-brand-primary,var(--dsw-alias-accent-primary,#3b82f6));border-bottom-color:var(--dsw-alias-brand-primary,var(--dsw-alias-accent-primary,#3b82f6));background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#ffffff));font-weight:600}",
				".dshqb_modal_body{padding:20px;overflow-x:hidden;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:18px;box-sizing:border-box;min-width:0}",
				".dshqb_form_group{display:flex;flex-direction:column;gap:6px;min-width:0}",
				".dshqb_form_label_row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}",
				".dshqb_form_label{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:normal;overflow-wrap:anywhere}",
				".dshqb_form_hint{display:block;font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.45;white-space:pre-line;overflow-wrap:anywhere}",
				".dshqb_input{background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.08)));border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.2)));border-radius:6px;padding:8px 12px;color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;width:100%;box-sizing:border-box;transition:border-color .15s ease,box-shadow .15s ease;outline:none}",
				".dshqb_input:focus{border-color:var(--dsw-alias-brand-primary,var(--dsw-alias-accent-primary,#3b82f6));box-shadow:0 0 0 2px rgba(59,130,246,0.2)}",
				".dshqb_select{background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.08)));border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.2)));border-radius:6px;padding:8px 12px;color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;width:100%;box-sizing:border-box;outline:none;cursor:pointer}",
				".dshqb_select option{background:var(--dsw-alias-bg-layer-1,#ffffff);color:var(--dsw-alias-label-primary)}",
				".dshqb_grid_2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;min-width:0}",
				".dshqb_grid_2>*{min-width:0}",
				"@media (max-width:560px){.dshqb_grid_2,.dshqb_field_grid{grid-template-columns:1fr}.dshqb_field_grid>.dshqb_field+.dshqb_field{border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.12))}}",
				/* Interactive Slider */
				".dshqb_slider_box{display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.04));padding:14px 16px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.12));margin-bottom:4px}",
				".dshqb_slider_track_wrap{position:relative;height:20px;margin-top:26px;margin-bottom:8px;display:flex;align-items:center;cursor:pointer;user-select:none;touch-action:none}",
				".dshqb_slider_track{position:absolute;left:0;right:0;height:8px;border-radius:999px;background:var(--dsw-alias-border-l2,rgba(128,128,128,0.18));overflow:hidden}",
				".dshqb_slider_fill_danger{position:absolute;left:0;top:0;bottom:0;background:var(--dsw-alias-state-error-primary,#ef4444)}",
				".dshqb_slider_fill_warning{position:absolute;top:0;bottom:0;background:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#f59e0b))}",
				".dshqb_slider_fill_success{position:absolute;right:0;top:0;bottom:0;background:var(--dsw-alias-state-success-primary,#10b981)}",
				".dshqb_slider_handle{position:absolute;top:50%;width:18px;height:18px;border-radius:50%;transform:translate(-50%, -50%);background:var(--dsw-alias-bg-base,#ffffff);box-shadow:var(--dsw-shadow-lv2,0 2px 8px rgba(0,0,0,0.25));cursor:grab;z-index:2;transition:transform .1s ease,box-shadow .1s ease;outline:none}",
				".dshqb_slider_handle:hover{transform:translate(-50%, -50%) scale(1.2);z-index:10}",
				".dshqb_slider_handle:active{cursor:grabbing;transform:translate(-50%, -50%) scale(1.25);box-shadow:0 0 0 4px rgba(59,130,246,0.3);z-index:10}",
				".dshqb_slider_handle_danger{border:3px solid var(--dsw-alias-state-error-primary,#ef4444)}",
				".dshqb_slider_handle_warning{border:3px solid var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#f59e0b))}",
				".dshqb_slider_badge{position:absolute;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%);background:var(--dsw-alias-bg-layer-1,var(--dsw-hovercard-bg,#ffffff));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.25));color:var(--dsw-alias-label-primary);padding:2px 7px;border-radius:5px;font-size:11px;font-weight:600;white-space:nowrap;pointer-events:none;box-shadow:var(--dsw-shadow-lv2,0 4px 12px rgba(0,0,0,0.15));display:flex;align-items:center;gap:4px;line-height:14px}",
				".dshqb_slider_badge::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:4px solid transparent;border-top-color:var(--dsw-alias-bg-layer-1,#ffffff)}",
				".dshqb_slider_legend{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 8px;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px;white-space:normal}",
				/* Pricing Table & Model Add */
				".dshqb_pricing_table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}",
				".dshqb_pricing_table th{text-align:left;padding:6px 8px;color:var(--dsw-alias-label-tertiary);font-weight:500;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.12))}",
				".dshqb_pricing_table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.06));vertical-align:middle}",
				".dshqb_period_tag{display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:500;white-space:nowrap}",
				".dshqb_period_peak{background:rgba(245,158,11,0.14);color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-warning-primary,#f59e0b))}",
				".dshqb_period_offpeak{background:rgba(16,185,129,0.14);color:var(--dsw-alias-state-success-primary,#10b981)}",
				".dshqb_period_flat{background:rgba(128,128,128,0.12);color:var(--dsw-alias-label-secondary)}",
				".dshqb_pricing_reset_bar{display:flex;justify-content:flex-end;margin-top:6px}",
				".dshqb_pricing_tier_row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
				".dshqb_input_num{width:80px;padding:4px 8px;font-size:12px}",
				".dshqb_btn_del{color:var(--dsw-alias-state-error-primary,#ef4444);background:transparent;border:none;cursor:pointer;padding:2px 6px;border-radius:4px;font-size:13px;line-height:1;transition:background-color .15s ease}",
				".dshqb_btn_del:hover{background:rgba(239,68,68,0.12)}",
				".dshqb_add_model_box{display:flex;flex-direction:column;gap:8px;align-items:stretch;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.03));border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,0.2));border-radius:6px;padding:8px 10px;margin-top:8px}",
				".dshqb_add_model_row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
				".dshqb_add_model_hint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.45;white-space:normal}",
				".dshqb_add_model_label{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}",
				".dshqb_input_mult{width:64px;padding:4px 8px;font-size:12px}",
				".dshqb_code_wrap{position:relative;margin-top:4px}",
				".dshqb_code_block{background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.06)));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.15));border-radius:8px;margin:0;padding:12px 46px 12px 12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-primary);overflow-x:auto;white-space:pre;line-height:1.5;max-height:220px}",
				".dshqb_code_copy_wrap{position:absolute;top:8px;right:8px}",
				".dshqb_code_copy{appearance:none;position:relative;width:28px;height:28px;padding:0;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.2));border-radius:6px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:var(--dsw-shadow-lv1,0 1px 4px rgba(0,0,0,.08));transition:color .15s ease,border-color .15s ease,background-color .15s ease,transform .15s ease}",
				".dshqb_code_copy:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.45));background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08))}",
				".dshqb_code_copy:active{transform:scale(.96)}",
				".dshqb_code_copy:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:2px}",
				".dshqb_code_copy_done{color:var(--dsw-alias-state-success-primary,#10b981)}",
				".dshqb_copy_icon{position:relative;display:block;width:14px;height:14px}",
				".dshqb_copy_icon:before,.dshqb_copy_icon:after{content:'';position:absolute;width:8px;height:9px;border:1.5px solid currentColor;border-radius:2px;box-sizing:border-box}",
				".dshqb_copy_icon:before{left:1px;top:1px;opacity:.6}",
				".dshqb_copy_icon:after{left:5px;top:4px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff))}",
				".dshqb_btn{padding:8px 16px;border-radius:6px;font-size:12.5px;font-weight:500;cursor:pointer;border:1px solid transparent;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:all .15s ease}",
				".dshqb_btn_primary{background:var(--dsw-alias-brand-primary,var(--dsw-alias-button-primary-fill,#3b82f6));color:var(--dsw-alias-label-primary-foreground,#ffffff);font-weight:600}",
				".dshqb_btn_primary:hover{filter:brightness(1.12)}",
				".dshqb_btn_secondary{background:var(--dsw-alias-button-tool-bar-fill,var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,0.1)));color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2,rgba(128,128,128,0.2))}",
				".dshqb_btn_secondary:hover{background:var(--dsw-alias-button-tool-bar-hover,var(--dsw-alias-interactive-bg-active,rgba(128,128,128,0.16)))}",
				".dshqb_btn_outline{background:transparent;border-color:var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.25)));color:var(--dsw-alias-label-secondary)}",
				".dshqb_btn_outline:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1,rgba(128,128,128,0.45));background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,0.06))}",
				".dshqb_btn:disabled{opacity:.5;cursor:not-allowed;filter:none}",
				".dshqb_modal_footer{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-top:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.12)));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.03))}",
				".dshqb_modal_footer_right{display:flex;gap:10px}",
				".dshqb_settings_head_copy{display:flex;flex-direction:column;gap:4px;min-width:0}",
				".dshqb_settings_desc{font-size:12.5px;font-weight:400;color:var(--dsw-alias-label-tertiary);line-height:1.45;white-space:normal}",
				".dshqb_unsaved{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;line-height:16px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.1));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.16));flex-shrink:0;white-space:nowrap}",
				".dshqb_toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);max-width:min(680px,calc(100vw - 32px));background:var(--dsw-alias-state-success-primary,#10b981);color:#ffffff;padding:9px 16px;border-radius:10px;box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,0.3));font-size:12.5px;font-weight:500;line-height:1.45;white-space:normal;z-index:100000;animation:dshqb-toast-in .2s ease-out;display:flex;align-items:center;gap:6px}",
				".dshqb_toast_error{background:var(--dsw-alias-state-error-primary,#dc2626)}",
				".dshqb_settings_page{position:relative;display:flex;flex-direction:column;gap:12px;min-width:0;width:100%;max-width:760px;box-sizing:border-box;white-space:normal}",
				".dshqb_settings_intro{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:0 2px}",
				".dshqb_settings_intro_copy{display:flex;flex-direction:column;gap:4px;min-width:0}",
				".dshqb_settings_intro_title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}",
				".dshqb_settings_title_control{display:flex;align-items:center;justify-content:flex-end;gap:9px;min-height:25px;flex:0 0 auto}",
				".dshqb_settings_title_control_label{font-size:12.5px;font-weight:500;line-height:1.4;color:var(--dsw-alias-label-secondary);white-space:nowrap}",
				".dshqb_pcard_list{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}",
				".dshqb_pcard{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.16));background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1,#fff));border-radius:12px;list-style:none;overflow:hidden;transition:border-color .16s,background .16s}",
				".dshqb_pcard:hover{border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,0.45))}",
				".dshqb_pcard_open{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.04));border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,0.45))}",
				".dshqb_pcard_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
				".dshqb_pcard_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:-2px}",
				".dshqb_pcard_head_text{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
				".dshqb_pcard_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
				".dshqb_pcard_desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5;font-weight:400}",
				".dshqb_pcard_chevron{color:var(--dsw-alias-label-tertiary);flex:none;width:14px;height:14px;transition:transform .16s;display:inline-flex;align-items:center;justify-content:center}",
				".dshqb_pcard_chevron_open{transform:rotate(180deg)}",
				".dshqb_pcard_body{border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.12));margin:0 16px;padding:4px 0 12px;display:flex;flex-direction:column;gap:0}",
				".dshqb_pcard_footer{border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.12));justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
				".dshqb_pcard_failed{min-width:0;color:var(--dsw-alias-state-error-primary,#ef4444);flex:1;margin:0;font-size:12px;line-height:1.5}",
				".dshqb_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}",
				".dshqb_field+.dshqb_field{border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.12))}",
				".dshqb_field_grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:16px;align-items:start;min-width:0}",
				".dshqb_field_grid>.dshqb_field{min-width:0;padding:10px 0}",
				".dshqb_field_grid>.dshqb_field+.dshqb_field{border-top:none}",
				".dshqb_field_grid>.dshqb_field:nth-child(n+3){border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.12))}",
				".dshqb_field_full{grid-column:1/-1}",
				".dshqb_slider_box+.dshqb_field_grid,.dshqb_field+.dshqb_field_grid,.dshqb_field_grid+.dshqb_field_grid,.dshqb_field_grid+.dshqb_field{border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.12))}",
				".dshqb_field_head{align-items:center;gap:8px;display:flex;flex-wrap:nowrap}",
				".dshqb_field_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}",
				".dshqb_field_badges{align-items:center;gap:8px;display:inline-flex;flex-shrink:0}",
				".dshqb_field_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,0.1));color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
				".dshqb_field_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:none;padding:0;font-size:12px;line-height:1.5}",
				".dshqb_field_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
				".dshqb_field_reset:disabled{cursor:default;opacity:.5}",
				".dshqb_model_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:none;padding:0;font-size:11px;white-space:nowrap}",
				".dshqb_model_reset:hover{color:var(--dsw-alias-label-primary)}",
				".dshqb_toggle_list{display:flex;flex-direction:column;gap:0;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.12));border-radius:8px;padding:2px 14px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.04))}",
				".dshqb_toggle_list>.dshqb_field{padding:11px 0}",
				".dshqb_toggle_list>.dshqb_field+.dshqb_field{border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.08))}",
				".dshqb_toggle_list .dshqb_field_head{align-items:flex-start}",
				".dshqb_toggle_row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:11px 0;cursor:pointer}",
				".dshqb_toggle_row+.dshqb_toggle_row{border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.08))}",
				".dshqb_toggle_copy{display:flex;flex-direction:column;gap:3px;min-width:0}",
				".dshqb_check{width:16px;height:16px;margin:0;flex-shrink:0;accent-color:var(--dsw-alias-brand-primary,#3b82f6);cursor:pointer}",
				".dshqb_switch{position:relative;display:inline-flex;width:38px;height:22px;flex:0 0 auto;vertical-align:middle}",
				".dshqb_switch_input{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
				".dshqb_switch_track{position:absolute;inset:0;border-radius:999px;background:var(--dsw-alias-border-l2,rgba(128,128,128,0.3));box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,rgba(128,128,128,0.18));cursor:pointer;transition:background-color .18s ease,box-shadow .18s ease}",
				".dshqb_switch_track:after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base,#fff);box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .18s ease}",
				".dshqb_switch_input:checked+.dshqb_switch_track{background:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,#3b82f6)}",
				".dshqb_switch_input:checked+.dshqb_switch_track:after{transform:translateX(16px)}",
				".dshqb_switch_input:focus-visible+.dshqb_switch_track{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:2px}",
				".dshqb_switch_input:disabled+.dshqb_switch_track{cursor:not-allowed;opacity:.55}",
				".dshqb_switch_large{width:44px;height:25px}",
				".dshqb_switch_large .dshqb_switch_track:after{width:19px;height:19px;top:3px;left:3px}",
				".dshqb_switch_large .dshqb_switch_input:checked+.dshqb_switch_track:after{transform:translateX(19px)}",
				".dshqb_layout_choices{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}",
				".dshqb_layout_choice{appearance:none;min-width:0;display:flex;align-items:center;gap:9px;padding:11px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.04));color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer;transition:border-color .15s ease,background-color .15s ease,color .15s ease,transform .15s ease}",
				".dshqb_layout_choice:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.45));color:var(--dsw-alias-label-primary)}",
				".dshqb_layout_choice:active:not(:disabled){transform:scale(.985)}",
				".dshqb_layout_choice:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:2px}",
				".dshqb_layout_choice:disabled{cursor:not-allowed;opacity:.55}",
				".dshqb_layout_choice_selected{border-color:var(--dsw-alias-brand-primary,#3b82f6);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 10%,transparent);color:var(--dsw-alias-label-primary)}",
				".dshqb_layout_choice_mark{position:relative;width:14px;height:14px;box-sizing:border-box;border:1.5px solid currentColor;border-radius:50%;flex:0 0 auto;opacity:.75}",
				".dshqb_layout_choice_selected .dshqb_layout_choice_mark{border-color:var(--dsw-alias-brand-primary,#3b82f6);opacity:1}",
				".dshqb_layout_choice_selected .dshqb_layout_choice_mark:after{content:'';position:absolute;inset:3px;border-radius:50%;background:var(--dsw-alias-brand-primary,#3b82f6)}",
				".dshqb_layout_choice_label{min-width:0;font-size:12.5px;font-weight:500;line-height:1.4}",
				".dshqb_settings_locked{opacity:.5;pointer-events:none;user-select:none;filter:grayscale(.2)}",
				".dshqb_settings_fieldset{display:block;min-width:0;margin:0;padding:0;border:0}",
				".dshqb_settings_cards{display:flex;flex-direction:column;gap:12px}",
				".dshqb_source_section{display:flex;flex-direction:column;gap:12px;padding:14px 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.12))}",
				".dshqb_source_head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
				".dshqb_source_head_copy{display:flex;flex-direction:column;gap:3px;min-width:0}",
				".dshqb_source_title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}",
				".dshqb_source_builtin{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:9px 10px;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.12));border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.04));font-size:11.5px;color:var(--dsw-alias-label-tertiary)}",
				".dshqb_source_chip{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 10%,transparent);color:var(--dsw-alias-label-secondary);font-weight:500}",
				".dshqb_template_group{display:flex;flex-direction:column;gap:7px}",
				".dshqb_template_group_title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);letter-spacing:.03em}",
				".dshqb_template_grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}",
				".dshqb_template_card{display:flex;align-items:flex-start;gap:10px;min-width:0;padding:10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.16));border-radius:9px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1,#fff))}",
				".dshqb_template_copy{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}",
				".dshqb_template_name{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary)}",
				".dshqb_template_desc{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}",
				".dshqb_source_list{display:flex;flex-direction:column;gap:7px}",
				".dshqb_custom_source_row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.12));border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.035))}",
				".dshqb_custom_source_copy{display:flex;flex-direction:column;gap:2px;min-width:0}",
				".dshqb_custom_source_name{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				".dshqb_custom_source_meta{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				".dshqb_custom_source_form{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 32%,transparent);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 4%,transparent)}",
				".dshqb_source_form_head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}",
				".dshqb_source_test{display:flex;flex-direction:column;align-items:stretch;gap:8px;padding:9px 10px;border-radius:8px;font-size:11.5px;line-height:1.45;min-width:0}",
				".dshqb_source_test_ok{background:rgba(16,185,129,.1);color:var(--dsw-alias-state-success-primary,#10b981)}",
				".dshqb_source_test_warn{background:rgba(245,158,11,.1);color:var(--dsw-alias-state-warning-primary,#d97706)}",
				".dshqb_source_test_bad{background:rgba(239,68,68,.1);color:var(--dsw-alias-state-error-primary,#ef4444)}",
				".dshqb_source_test_head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;min-width:0}",
				".dshqb_source_test_message{min-width:0;overflow-wrap:anywhere}",
				".dshqb_diagnostic_preview{margin:0;max-height:150px;overflow:auto;padding:8px 9px;border-radius:6px;background:rgba(0,0,0,.06);color:var(--dsw-alias-label-secondary);font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}",
				".dshqb_diagnostic_copy{flex:0 0 auto;border:0;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px;padding:0}",
				".dshqb_source_actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:2px}",
				".dshqb_source_advanced{border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.12));padding-top:8px}",
				".dshqb_source_advanced>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;user-select:none}",
				".dshqb_source_advanced[open]>summary{margin-bottom:6px}",
				".dshqb_provider_quota_intro{margin:10px 0 2px;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.04));color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.5}",
				".dshqb_provider_quota_empty{margin:10px 0 2px;padding:18px 14px;border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.2));border-radius:9px;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center}",
				".dshqb_provider_quota_list{display:flex;flex-direction:column;gap:9px;padding:10px 0 2px}",
				".dshqb_provider_quota_item{display:flex;flex-direction:column;gap:9px;padding:12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.16));border-radius:10px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1,#fff));transition:border-color .15s ease,opacity .15s ease}",
				".dshqb_provider_quota_item:hover{border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.4))}",
				".dshqb_provider_quota_item_off{opacity:.72}",
				".dshqb_provider_quota_head,.dshqb_provider_quota_summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}",
				".dshqb_provider_quota_identity{display:flex;flex-direction:column;gap:1px;min-width:0}",
				".dshqb_provider_quota_name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				".dshqb_provider_quota_id{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				".dshqb_provider_quota_badges{display:inline-flex;align-items:center;justify-content:flex-end;gap:9px;flex:0 0 auto}",
				".dshqb_provider_quota_summary{padding-top:8px;border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.1))}",
				".dshqb_provider_quota_source{min-width:0;color:var(--dsw-alias-label-secondary);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				".dshqb_provider_quota_editor{display:flex;flex-direction:column;gap:9px;padding:10px 11px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 28%,transparent);border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 4%,transparent)}",
				".dshqb_provider_editor_footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:3px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.12))}.dshqb_provider_editor_save_hint{margin-right:auto;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.4}.dshqb_provider_editor_save_hint_error{color:var(--dsw-alias-danger,#dc2626)}",
				".dshqb_provider_custom,.dshqb_provider_mapping,.dshqb_provider_template_test{display:flex;flex-direction:column;gap:8px}",
				".dshqb_textarea{min-height:88px;resize:vertical;line-height:1.45;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}",
				".dshqb_header_list,.dshqb_metric_list{display:flex;flex-direction:column;gap:8px}",
				".dshqb_header_row{display:grid;grid-template-columns:minmax(120px,.8fr) minmax(160px,1.2fr) auto;gap:7px;align-items:center}",
				".dshqb_metric_editor{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.12));border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.035))}",
				".dshqb_metric_editor_head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary)}",
				".dshqb_secret_input{display:flex;flex-direction:column;gap:5px}.dshqb_secret_status{font-size:11px;line-height:1.35;color:var(--dsw-alias-success,#16a34a)}",
				"@media (max-width:620px){.dshqb_template_grid{grid-template-columns:1fr}.dshqb_custom_source_row{grid-template-columns:minmax(0,1fr) auto}.dshqb_custom_source_row>.dshqb_btn:last-child{grid-column:2}.dshqb_source_head{flex-direction:column;align-items:stretch}.dshqb_settings_intro{gap:12px}.dshqb_settings_title_control_label{display:none}}",
				"@media (max-width:620px){.dshqb_header_row{grid-template-columns:1fr auto}.dshqb_header_row>.dshqb_input:nth-child(2){grid-column:1}}",
				".dshqb_confirm_mask{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,0.45));backdrop-filter:blur(6px)}",
				".dshqb_confirm{width:min(380px,100%);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.18));border-radius:12px;box-shadow:var(--dsw-shadow-lv3,0 16px 40px rgba(0,0,0,0.22));padding:18px 18px 16px;display:flex;flex-direction:column;gap:8px;box-sizing:border-box}",
				".dshqb_confirm_title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}",
				".dshqb_confirm_body{font-size:13px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:normal}",
				".dshqb_confirm_actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}",
				"[data-dshqb-nav]>[class*='_navIcon']{display:none}",
				"[data-dshqb-nav]:before{content:'';background:currentColor;flex:none;width:16px;height:16px}",
				"[data-dshqb-nav='credits']:before{-webkit-mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' d='M8 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM5.4 3.9h1.15L8 6.2 9.45 3.9H10.6L8.85 7.15H10.25v1.05H8.85v.5H10.25v1.05H8.85V12.15H7.15V9.75H5.75V8.7H7.15v-.5H5.75V7.15H7.15L5.4 3.9z'/%3E%3C/svg%3E\") 50%/contain no-repeat;mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' d='M8 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM5.4 3.9h1.15L8 6.2 9.45 3.9H10.6L8.85 7.15H10.25v1.05H8.85v.5H10.25v1.05H8.85V12.15H7.15V9.75H5.75V8.7H7.15v-.5H5.75V7.15H7.15L5.4 3.9z'/%3E%3C/svg%3E\") 50%/contain no-repeat}",
				"[data-dshqb-nav='webui']:before{-webkit-mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z'/%3E%3C/svg%3E\") 50%/contain no-repeat;mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z'/%3E%3C/svg%3E\") 50%/contain no-repeat}",
				"[data-dshqb-nav='skin']:before{-webkit-mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' d='M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zm0-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'/%3E%3C/svg%3E\") 50%/contain no-repeat;mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' d='M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zm0-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'/%3E%3C/svg%3E\") 50%/contain no-repeat}",
				"[data-dshqb-nav='pet']:before{-webkit-mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cellipse cx='8' cy='11' rx='4.2' ry='2.8'/%3E%3Ccircle cx='2.8' cy='6.2' r='1.9'/%3E%3Ccircle cx='8' cy='4.6' r='1.9'/%3E%3Ccircle cx='13.2' cy='6.2' r='1.9'/%3E%3C/svg%3E\") 50%/contain no-repeat;mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cellipse cx='8' cy='11' rx='4.2' ry='2.8'/%3E%3Ccircle cx='2.8' cy='6.2' r='1.9'/%3E%3Ccircle cx='8' cy='4.6' r='1.9'/%3E%3Ccircle cx='13.2' cy='6.2' r='1.9'/%3E%3C/svg%3E\") 50%/contain no-repeat}",
				"[data-dshqb-nav='community']:before{-webkit-mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='5.5' cy='5.5' r='3'/%3E%3Ccircle cx='11' cy='5.5' r='3'/%3E%3Cpath d='M2.5 13.5c0-3 2-4.2 3-4.2H11c1.5 0 3 1.2 3 4.2z'/%3E%3C/svg%3E\") 50%/contain no-repeat;mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='5.5' cy='5.5' r='3'/%3E%3Ccircle cx='11' cy='5.5' r='3'/%3E%3Cpath d='M2.5 13.5c0-3 2-4.2 3-4.2H11c1.5 0 3 1.2 3 4.2z'/%3E%3C/svg%3E\") 50%/contain no-repeat}"
			].join("\n");
			document.head.appendChild(tag);
		}
		//#endregion

		//#region formatting
		const CURRENCY_SYMBOLS = { CNY: "¥", USD: "$", EUR: "€" };
		const currencySymbol = (currency) => CURRENCY_SYMBOLS[currency] ?? currency + " ";
		/** 余额/花费显示: 0 显示 2 位, 大额 2 位小数, 小额 3~4 位。 */
		function formatMoney(amount, currency) {
			if (amount === 0) return currencySymbol(currency) + "0.00";
			const fixed = amount >= 1 ? 2 : amount >= 0.01 ? 3 : 4;
			return currencySymbol(currency) + amount.toFixed(fixed);
		}
		/** 紧凑 token 数: 517 / 12.2K / 517K / 1.2M。 */
		function formatTokens(n) {
			const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
			if (n < 1e3) return String(n);
			if (n < 1e6) return scaled(n / 1e3) + "K";
			return scaled(n / 1e6) + "M";
		}
		function formatTokensPerSecond(n) {
			const value = Number(n);
			if (!Number.isFinite(value)) return "—";
			return value < 100 ? String(Math.round(value * 10) / 10) : String(Math.round(value));
		}
		function formatClock(ms) {
			if (ms <= 0) return "—";
			return new Date(ms).toLocaleTimeString();
		}
		/** 百分比显示: null 显示 —, 否则最多 1 位小数。 */
		function formatPercent(n) {
			if (n === null || n === undefined || !Number.isFinite(n)) return "—";
			return String(Math.round(n * 10) / 10) + "%";
		}
		/** ISO 时间显示(尽量本地化)。 */
		function formatResetTime(iso) {
			if (!iso || typeof iso !== "string") return "—";
			const d = new Date(iso);
			return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
		}
		/** 单价显示: 整数去尾零(¥2 / ¥8), 小数保留 ≤3 位(¥0.2)。 */
		function formatPrice(n, currency) {
			const num = Number(n);
			if (!Number.isFinite(num)) return currencySymbol(currency) + "?";
			return currencySymbol(currency) + (num % 1 === 0 ? String(num) : String(Math.round(num * 1000) / 1000));
		}
		const normalizeProvider = (value) => String(value ?? "").trim().toLowerCase();
		const providerMatchesAdapter = (adapter, provider) => {
			const p = normalizeProvider(provider);
			if (!p) return false;
			if (normalizeProvider(adapter?.id) === p) return true;
			if ((adapter?.providerIds ?? []).some((id) => normalizeProvider(id) === p)) return true;
			return (adapter?.providerPatterns ?? []).some((pattern) => {
				try {
					return new RegExp(pattern, "i").test(p);
				} catch {
					return false;
				}
			});
		};
		/** 在 payload 的配额源列表中匹配一个 provider / 源 id。 */
		function matchQuotaAdapter(provider, quotaSources) {
			const list = Array.isArray(quotaSources) && quotaSources.length > 0 ? quotaSources : null;
			if (!list) {
				const p = normalizeProvider(provider);
				if (p === "opencode-go") return { id: "opencode-go" };
				if (p === "deepseek") return { id: "deepseek" };
				return null;
			}
			return list.find((adapter) => providerMatchesAdapter(adapter, provider)) ?? null;
		}
		/** 默认额度源。 */
		function defaultQuotaAdapter(quotaSources) {
			const list = Array.isArray(quotaSources) && quotaSources.length > 0 ? quotaSources : null;
			if (list) return list.find((source) => source.default === true) ?? list[0] ?? null;
			return { id: "deepseek" };
		}
		/** 供应商/源 id → 额度源 id。未命中时回退默认源。 */
		function quotaSourceFromProvider(provider, quotaSources) {
			return matchQuotaAdapter(provider, quotaSources)?.id ?? defaultQuotaAdapter(quotaSources)?.id ?? "deepseek";
		}
		/** follow: 跟当前模型; custom: 固定用 config.provider, 忽略当前模型。 */
		function resolveQuotaSource(modelProvider, config, quotaSources) {
			if (String(config?.quotaMode ?? "follow").trim().toLowerCase() === "custom") {
				return quotaSourceFromProvider(config?.provider, quotaSources);
			}
			if (modelProvider !== null && modelProvider !== undefined && normalizeProvider(modelProvider) !== "") {
				return matchQuotaAdapter(modelProvider, quotaSources)?.id
					?? matchQuotaAdapter(config?.provider, quotaSources)?.id
					?? defaultQuotaAdapter(quotaSources)?.id
					?? "deepseek";
			}
			return quotaSourceFromProvider(config?.provider, quotaSources);
		}
		function normalizeDockLayout(value) {
			return String(value ?? "own").trim().toLowerCase() === "shared" ? "shared" : "own";
		}
		function mergeQuotaView(payload, source) {
			if (!payload || typeof payload !== "object") return payload;
			const view = payload.views?.[source];
			const next = view && typeof view === "object"
				? { ...payload, ...view, provider: source }
				: { ...payload, provider: source };
			if (!view || typeof view !== "object") return next;
			if (view.kind === "balance" || (!view.kind && view.balances)) {
				delete next.usage;
				delete next.metrics;
			} else if (view.kind === "usage" || (!view.kind && view.usage)) {
				delete next.balances;
				delete next.isAvailable;
				delete next.metrics;
			} else {
				delete next.usage;
				delete next.balances;
				delete next.isAvailable;
			}
			return next;
		}
		const noopSubscribe = () => () => {};
		let modelDirectories = null;
		const modelDirListeners = new Set();
		function setModelDirectories(value) {
			modelDirectories = value ?? null;
			for (const fn of [...modelDirListeners]) fn();
		}
		/** 余额状态等级判定 (充足 success / 偏低 warning / 告急 danger) */
		function getStatusLevel(total, isAvailable, thresholds) {
			if (!isAvailable) return "danger";
			const danger = typeof thresholds?.danger === "number" ? thresholds.danger : 5;
			const warning = typeof thresholds?.warning === "number" ? thresholds.warning : 10;
			if (total < danger) return "danger";
			if (total < warning) return "warning";
			return "success";
		}
		/** 与服务端 src/pricing.js 同一套 V4 峰谷表; 客户端按每笔 legs[].t 计价。 */
		const V4_CUTOFF_MS = 1786896000000;
		const PINNED_V4_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];
		const V4_CNY = {
			"deepseek-v4-flash": { listed: { cacheHit: 0.02, cacheMiss: 1, output: 2 }, peak: { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 }, offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 } },
			"deepseek-v4-pro": { listed: { cacheHit: 0.025, cacheMiss: 3, output: 6 }, peak: { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 }, offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 } },
			"deepseek-v4-flash-vision-exp": { listed: { cacheHit: 0.02, cacheMiss: 1, output: 2 }, peak: { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 }, offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 } }
		};
		const scaleUsd = (p) => ({ cacheHit: Math.round(p.cacheHit * 0.14 * 1e6) / 1e6, cacheMiss: Math.round(p.cacheMiss * 0.14 * 1e6) / 1e6, output: Math.round(p.output * 0.14 * 1e6) / 1e6 });
		const V4_USD = Object.fromEntries(Object.entries(V4_CNY).map(([model, tiers]) => [model, {
			listed: scaleUsd(tiers.listed),
			peak: scaleUsd(tiers.peak),
			offPeak: scaleUsd(tiers.offPeak)
		}]));
		function v4TableFor(currency) {
			return currency === "USD" ? V4_USD : V4_CNY;
		}
		function isFiniteRate(p) {
			return p && [p.cacheHit, p.cacheMiss, p.output].every((n) => Number.isFinite(Number(n)));
		}
		function hasTariffTiers(p) {
			return isFiniteRate(p?.peak) && isFiniteRate(p?.offPeak);
		}
		function cloneRate(p) {
			return { cacheHit: Number(p.cacheHit), cacheMiss: Number(p.cacheMiss), output: Number(p.output) };
		}
		function roundPrice(n) {
			return Math.round(Number(n) * 1e6) / 1e6;
		}
		function scaleRate(p, m) {
			return { cacheHit: roundPrice(p.cacheHit * m), cacheMiss: roundPrice(p.cacheMiss * m), output: roundPrice(p.output * m) };
		}
		function normalizeMultiplier(n) {
			const m = Number(n);
			if (!Number.isFinite(m) || m <= 0) return 1;
			return m;
		}
		function isFlatMultiplier(n) {
			return Math.abs(normalizeMultiplier(n) - 1) < 1e-9;
		}
		function withTiers(peak, offPeak) {
			const p = cloneRate(peak);
			const o = cloneRate(offPeak);
			return { ...p, peak: p, offPeak: o };
		}
		function buildAddedModelPrice(multiplier, peakRates) {
			const peak = cloneRate(peakRates);
			if (isFlatMultiplier(multiplier)) return peak;
			return withTiers(peak, scaleRate(peak, normalizeMultiplier(multiplier)));
		}
		function v4SettingsFromTable(tiers) {
			return { ...cloneRate(tiers.peak), peak: cloneRate(tiers.peak), offPeak: cloneRate(tiers.offPeak) };
		}
		function snapshotModelPrice(p) {
			const base = { cacheHit: Number(p?.cacheHit), cacheMiss: Number(p?.cacheMiss), output: Number(p?.output) };
			if (hasTariffTiers(p)) return { ...base, peak: cloneRate(p.peak), offPeak: cloneRate(p.offPeak) };
			return base;
		}
		function hydrateModelPrice(model, rates, currency) {
			if (hasTariffTiers(rates)) {
				return { ...cloneRate(rates.peak), peak: cloneRate(rates.peak), offPeak: cloneRate(rates.offPeak) };
			}
			if (PINNED_V4_MODELS.includes(model)) {
				const table = v4TableFor(currency)?.[model];
				if (table) return v4SettingsFromTable(table);
			}
			return { cacheHit: Number(rates?.cacheHit ?? 0), cacheMiss: Number(rates?.cacheMiss ?? 0), output: Number(rates?.output ?? 0) };
		}
		function hydratePrices(prices, currency) {
			const next = {};
			for (const [model, rates] of Object.entries(prices || {})) next[model] = hydrateModelPrice(model, rates, currency);
			return next;
		}
		function isPeakBeijing(timestamp) {
			const beijing = new Date(Number(timestamp) + 8 * 3600 * 1000);
			const hour = beijing.getUTCHours();
			const dow = beijing.getUTCDay();
			if (dow === 0 || dow === 6) return false;
			return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
		}
		/** 当前北京时间峰谷时段; 与 V4 计价时段保持一致。 */
		function currentTariffPeriod(timestamp = Date.now()) {
			return isPeakBeijing(timestamp) ? "peak" : "offPeak";
		}
		function resolveClientPrice(cfg, model, timestamp) {
			const currency = cfg.currency || "CNY";
			const table = v4TableFor(currency)?.[model];
			const configured = cfg.prices?.[model];
			if (hasTariffTiers(configured)) {
				if (table && timestamp < V4_CUTOFF_MS) return table.listed;
				return cloneRate(isPeakBeijing(timestamp) ? configured.peak : configured.offPeak);
			}
			if (isFiniteRate(configured) && !(table && PINNED_V4_MODELS.includes(model))) {
				return cloneRate(configured);
			}
			if (table) {
				if (timestamp < V4_CUTOFF_MS) return table.listed;
				return isPeakBeijing(timestamp) ? table.peak : table.offPeak;
			}
			return configured ?? cfg.defaultPrices ?? { cacheHit: 0, cacheMiss: 0, output: 0 };
		}
		function priceLeg(cfg, leg) {
			const p = resolveClientPrice(cfg, leg.model, Number(leg.t) || 0);
			return ((Number(leg.uncachedInput) + Number(leg.cacheWrite)) * Number(p.cacheMiss ?? 0)
				+ Number(leg.cacheRead) * Number(p.cacheHit ?? 0)
				+ Number(leg.output) * Number(p.output ?? 0)) / 1e6;
		}
		/** 用当前计价货币按每笔事件时间重算本会话; 不用 /query-credits 里“此刻”的 V4 单价。 */
		function priceSession(cost, payload) {
			const currency = payload?.currency ?? cost?.currency ?? "CNY";
			const cfg = {
				currency,
				prices: payload?.prices,
				defaultPrices: payload?.defaultPrices
			};
			const legs = Array.isArray(cost?.legs) ? cost.legs : [];
			if (!cost) {
				return { cost: 0, costByModel: {}, models: [], tokens: undefined, currency, legs: [] };
			}
			if (legs.length === 0) {
				return {
					cost: cost.cost ?? 0,
					costByModel: cost.costByModel ?? {},
					models: cost.models ?? [],
					tokens: cost.tokens,
					currency: cost.currency ?? currency,
					legs
				};
			}
			const costByModel = {};
			let total = 0;
			for (const leg of legs) {
				const c = priceLeg(cfg, leg);
				if (c > 0) costByModel[leg.model] = Math.round(((costByModel[leg.model] ?? 0) + c) * 1e6) / 1e6;
				total += c;
			}
			return {
				cost: Math.round(total * 1e6) / 1e6,
				costByModel,
				models: cost.models ?? [],
				tokens: cost.tokens,
				currency,
				legs
			};
		}
		const CAP_STORE_KEY = "dsh-credits-cap";
		function readCapState() {
			try {
				const raw = JSON.parse((typeof localStorage !== "undefined" && localStorage.getItem(CAP_STORE_KEY)) || "null");
				if (raw && typeof raw === "object") return raw;
			} catch { /* ignore */ }
			return {};
		}
		function writeCapState(patch) {
			try {
				if (typeof localStorage === "undefined") return;
				localStorage.setItem(CAP_STORE_KEY, JSON.stringify({ ...readCapState(), ...patch }));
			} catch { /* ignore */ }
		}
		/** 官方定价页。 */
		const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
		//#endregion

		//#region balance store (单例轮询器: 全页面共享一个 fetch 循环)
		const DEFAULT_POLL_MS = 30000;
		let snapshot = { status: "loading", isRefreshing: false };
		const listeners = new Set();
		let timer = null;
		let pollMs = DEFAULT_POLL_MS;
		let inflight = null;
		let started = false;

		function notify() {
			for (const fn of [...listeners]) fn();
		}

		async function refresh(force = false, source = null) {
			if (inflight !== null) return inflight;
			if (force && snapshot.isRefreshing !== true) {
				snapshot = { ...snapshot, isRefreshing: true };
				notify();
			}
			inflight = (async () => {
				try {
					const params = [];
					if (force) params.push("force=1");
					if (source) params.push("source=" + encodeURIComponent(source));
					const url = "/query-credits" + (params.length ? "?" + params.join("&") : "");
					const res = await fetch(url, {
						cache: "no-store",
						headers: { accept: "application/json" }
					});
					if (!res.ok) throw new Error("HTTP " + res.status);
					const data = await res.json();
					if (typeof data.clientPollIntervalMs === "number" && data.clientPollIntervalMs >= 5000) {
						pollMs = Math.min(data.clientPollIntervalMs, 3600000);
					}
					snapshot = { status: "ok", payload: data, at: Date.now(), isRefreshing: false };
				} catch (error) {
					snapshot = {
						status: "error",
						message: error instanceof Error ? error.message : String(error),
						at: Date.now(),
						isRefreshing: false
					};
				}
				inflight = null;
				notify();
			})();
			return inflight;
		}

		function schedule() {
			if (timer !== null) return;
			timer = setTimeout(() => {
				timer = null;
				if (document.hidden) return; // 页面隐藏时暂停; 由 visibilitychange 恢复
				refresh().then(schedule, schedule);
			}, pollMs);
		}

		const balanceStore = {
			subscribe(fn) {
				listeners.add(fn);
				if (!started) {
					started = true;
					refresh().then(schedule, schedule);
				}
				return () => {
					listeners.delete(fn);
					if (listeners.size === 0) {
						started = false;
						if (timer !== null) {
							clearTimeout(timer);
							timer = null;
						}
					}
				};
			},
			getSnapshot() {
				return snapshot;
			},
			forceRefresh(source) {
				return refresh(true, source || null);
			}
		};

		let spendSnap = (() => {
			const saved = readCapState();
			return {
				status: "loading",
				payload: null,
				range: typeof saved.range === "string" ? saved.range : "today",
				from: typeof saved.from === "string" ? saved.from : "",
				to: typeof saved.to === "string" ? saved.to : ""
			};
		})();
		const spendListeners = new Set();
		let spendTimer = null;
		let spendStarted = false;
		function notifySpend() {
			for (const fn of [...spendListeners]) fn();
		}
		async function refreshSpend() {
			try {
				const q = new URLSearchParams({ range: spendSnap.range });
				if (spendSnap.range === "custom") {
					if (spendSnap.from) q.set("from", spendSnap.from);
					if (spendSnap.to) q.set("to", spendSnap.to);
				}
				const res = await fetch("/query-credits/spend?" + q.toString(), {
					cache: "no-store",
					headers: { accept: "application/json" }
				});
				if (!res.ok) throw new Error("HTTP " + res.status);
				const data = await res.json();
				spendSnap = { ...spendSnap, status: data && data.ok ? "ok" : "error", payload: data };
			} catch (error) {
				spendSnap = {
					...spendSnap,
					status: "error",
					payload: { error: error instanceof Error ? error.message : String(error) }
				};
			}
			notifySpend();
		}
		function scheduleSpend() {
			if (spendTimer !== null) return;
			spendTimer = setTimeout(() => {
				spendTimer = null;
				if (document.hidden) return;
				refreshSpend().then(scheduleSpend, scheduleSpend);
			}, 30000);
		}
		const spendStore = {
			subscribe(fn) {
				spendListeners.add(fn);
				if (!spendStarted) {
					spendStarted = true;
					refreshSpend().then(scheduleSpend, scheduleSpend);
				}
				return () => {
					spendListeners.delete(fn);
					if (spendListeners.size === 0) {
						spendStarted = false;
						if (spendTimer !== null) {
							clearTimeout(spendTimer);
							spendTimer = null;
						}
					}
				};
			},
			getSnapshot() {
				return spendSnap;
			},
			setRange(range, from, to) {
				spendSnap = { ...spendSnap, range, from: from ?? "", to: to ?? "" };
				writeCapState({ range: spendSnap.range, from: spendSnap.from, to: spendSnap.to });
				notifySpend();
				return refreshSpend();
			},
			refresh: refreshSpend
		};
		//#endregion

		//#region locale
		const NS = "queryBalance";
		const zh = {
			"balance": "余额 {amount}",
			"balance.readoutCustom": "{name} · 余额 {amount}",
			"balanceError": "余额不可用",
			"balanceMissing": "未配置 API Key",
			"status.sufficient": "充足",
			"status.warning": "偏低",
			"status.danger": "告急",
			"btn.refresh": "点击立即刷新余额",
			"btn.refreshing": "正在刷新余额...",
			"sessionCost": "本会话约 {amount}",
			"tps": "TPS {rate} tok/s",
			"card.balanceTitle": "📊 账户余额",
			"card.sessionTitle": "⚡ 本会话消耗",
			"card.total": "总额: ",
			"card.wallet": "{currency} 钱包",
			"card.topup": "充值 {amount}",
			"card.granted": "赠送 {amount}",
			"card.updated": "更新于 {time} · 每 {interval} 刷新",
			"card.refreshHint": "💡 点击状态灯或卡片上的状态/百分比可立即刷新",
			"card.tokens": "Token: 输入 {input} · 输出 {output}",
			"card.tokensHit": "命中: {hit} ({hitRate}%)",
			"card.noCost": "本会话暂未产生消耗",
			"card.pricingHint": "💡 计价规则与单价请见右侧 [?]",
			"tariff.peak": "梁文峰时刻",
			"tariff.offPeak": "梁文谷时刻",
			"tariff.peakTitle": "梁文峰时刻：北京时间周一至周五 09:00–12:00、14:00–18:00\n梁文谷时刻：其余时段（含周末）",
			"tariff.offPeakTitle": "梁文峰时刻：北京时间周一至周五 09:00–12:00、14:00–18:00\n梁文谷时刻：其余时段（含周末）",
			"card.error": "【账户余额】异常: {error}",
			/* OpenCode Go quota translations */
			"quota.readout": "Go 额度 月 {monthly} · 周 {weekly} · 5h {rolling}",
			"quota.readoutCustom": "{name} · {windows}",
			"quota.cardTitle": "🧾 OpenCode Go 额度",
			"quota.remaining": "剩余 {percent}",
			"quota.rolling": "5 小时滚动",
			"quota.weekly": "每周",
			"quota.monthly": "每月",
			"quota.resets": "{time} 重置",
			"quota.error": "【OpenCode Go 额度】异常: {error}",
			"quota.unavailable": "OpenCode Go 额度不可用",
			"btn.refreshQuota": "点击立即刷新 OpenCode Go 额度",
			"btn.refreshingQuota": "正在刷新 OpenCode Go 额度...",
			"card.sessionHintQuota": "💡 本会话按设置单价估算，实际扣减以 Go 套餐窗口为准。",
			"quota.cardTitleCustom": "🎯 额度用量",
			"quota.valueTotal": "剩余 {value} / {total} {unit}",
			"quota.errorCustom": "【额度用量】异常: {error}",
			"quota.unavailableCustom": "额度用量不可用",
			"btn.refreshCustom": "点击立即刷新额度",
			"btn.refreshingCustom": "正在刷新额度...",
			"card.sessionHintCustom": "💡 本会话按设置单价估算，实际扣减以所选套餐/额度为准。",
			"pricing.title": "📋 DeepSeek V4 定价参考",
			"pricing.rateBadge": "每 1M tokens · {currency}",
			"pricing.hit": "命中 {price}",
			"pricing.miss": "未命中 {price}",
			"pricing.output": "输出 {price}",
			"pricing.link": "查看官方完整定价页 ›",
			"pricing.aria": "查看 DeepSeek 定价策略",
			"model.unknown": "未知模型",
			"model.other": "其他模型",
			"unit.minutes": "{n} 分钟",
			"unit.seconds": "{n} 秒",
			/* Settings translations */
			"settings.nav": "额度",
			"settings.title": "额度与消耗",
			"settings.desc": "底部额度、累计消耗与模型单价。",
			"settings.unsaved": "未保存",
			"settings.overridden": "已覆盖",
			"settings.resetField": "恢复默认",
			"settings.expand": "展开设置",
			"settings.collapse": "收起设置",
			"settings.card.display": "展示",
			"settings.card.displayDesc": "底部条、累计胶囊与悬停卡片。",
			"settings.card.quota": "额度查询",
			"settings.card.quotaDesc": "按 DSH 供应商分别选择额度来源；切换模型供应商时自动展示对应额度。",
			"settings.card.thresholds": "阈值与刷新",
			"settings.card.thresholdsDesc": "状态灯阈值与后台查询频率。",
			"settings.card.pricing": "模型单价",
			"settings.card.pricingDesc": "各模型每 1M Token 的命中 / 未命中 / 输出价。添加时填写高峰价；峰谷倍率默认为 1（无峰谷），0.5 表示低谷 = 高峰 × 0.5。",
			"settings.card.export": "YAML 导出",
			"settings.card.exportDesc": "复制到 cordis.patch.yml 做持久覆盖。",
			"settings.enabled": "启用额度功能",
			"settings.enabledHint": "关闭后隐藏额度、TPS、峰谷徽章、悬停详情与累计消耗，并锁定展示、额度查询、阈值与刷新；模型单价和 YAML 导出仍可用。",
			"settings.showDock": "底部统计条",
			"settings.showDockHint": "输入框下方的额度与本会话消耗。",
			"settings.dockLayout": "底部条布局",
			"settings.dockLayout.own": "独立换行",
			"settings.dockLayout.shared": "共用一行",
			"settings.dockLayoutHint": "单独占一行，或跟底部统计并排。",
			"settings.showCapsule": "累计消耗胶囊",
			"settings.showCapsuleHint": "右下角可拖拽的累计消耗。",
			"settings.showPopover": "悬停详情气泡",
			"settings.showPopoverHint": "悬停底部读数时显示明细。",
			"settings.showTps": "实时 TPS",
			"settings.showTpsHint": "显示流式输出的实时生成速度。",
			"settings.quotaMode": "额度查询模式",
			"settings.quotaMode.follow": "跟随当前模型供应商",
			"settings.quotaMode.custom": "固定展示一个额度源",
			"settings.quotaModeHint": "自动模式会跟随当前供应商；没有匹配项时使用下方回退源。",
			"settings.currency": "计价货币",
			"settings.currencyHint": "用于本会话估算与状态灯。",
			"settings.currencyHintQuota": "只影响本会话估算。",
			"settings.warning": "预警阈值 (黄灯 🟡)",
			"settings.warningHint": "低于此值亮黄灯。",
			"settings.danger": "告急阈值 (红灯 🔴)",
			"settings.dangerHint": "低于此值亮红灯。",
			"settings.sliderHint": "拖动或点击轨道设置告急/预警线。",
			"settings.serverInterval": "服务端查询间隔",
			"settings.provider": "未匹配时展示",
			"settings.provider.deepseek": "DeepSeek 官方余额",
			"settings.provider.opencode": "OpenCode Go 订阅用量",
			"settings.providerHintFollow": "当前供应商没有匹配额度源时，展示这里选定的数据。",
			"settings.providerHintCustom": "固定模式下始终展示这里选定的数据。",
			"settings.opencodeApiKeyRef": "OpenCode Go 凭证引用名",
			"settings.opencodeApiKeyRefHint": "从环境变量或 credentials 读取。",
			"settings.opencodeApiKey": "OpenCode Go API Key",
			"settings.opencodeApiKeyHint": "留空则用环境变量或 auth.json。",
			"settings.opencodeBaseUrl": "OpenCode Go Usage API",
			"settings.customSources": "额度源模板",
			"settings.sourceSectionHint": "先匹配 DSH 内置供应商并复用凭证；没有支持项时再选官方模板。",
			"settings.builtinSources": "无需添加，直接在上方选择：",
			"settings.dshDetected": "优先使用 DSH 内置供应商",
			"settings.dshReuse": "复用 DSH 凭证 · {template}",
			"settings.dshReady": "DSH 已配置，直接复用凭证 · {template}",
			"settings.dshNotReady": "DSH 内置，尚未启用；可先添加模板 · {template}",
			"settings.dshCredential": "凭证来自 DSH 供应商：",
			"settings.dshCredentialPending": "该 DSH 供应商尚未启用；启用后会自动复用凭证，也可在高级设置填凭证引用：",
			"settings.providerQuota.intro": "这里只列出已启用或已配置过额度的 DSH 供应商。每个供应商独立查询，多个 OpenCode Go 账号也不会共用额度缓存。",
			"settings.providerQuota.empty": "DSH 中还没有已启用的供应商。请先在供应商设置中添加并启用一个供应商。",
			"settings.providerQuota.enabled": "展示该供应商额度",
			"settings.providerQuota.hidden": "不展示额度",
			"settings.providerQuota.configured": "DSH 已启用",
			"settings.providerQuota.source": "额度信息来源",
			"settings.providerQuota.auto": "自动识别（推荐）",
			"settings.providerQuota.template": "使用内置模板",
			"settings.providerQuota.reuse": "复用另一供应商的额度",
			"settings.providerQuota.custom": "自定义 HTTP 接口",
			"settings.providerQuota.autoSummary": "自动识别 · {template}",
			"settings.providerQuota.reuseSummary": "复用 · {name}",
			"settings.providerQuota.autoHint": "按供应商 ID 和 Base URL 识别模板，并直接复用该供应商在 DSH 保存的地址与 Key。",
			"settings.providerQuota.templateHint": "模板自带官方查询地址和解析规则，凭证直接复用当前 DSH 供应商。",
			"settings.providerQuota.reuseHint": "两个模型供应商实际使用同一账号时，可直接展示另一供应商已经查到的额度。",
			"settings.providerQuota.customHint": "只需填写接口地址、选择凭证来源，再测试并选择返回字段。",
			"settings.providerQuota.saveHint": "修改不会自动保存；点击“保存”后才会生效。",
			"settings.providerQuota.templateSelect": "内置模板",
			"settings.providerQuota.reuseSelect": "额度来自",
			"settings.providerQuota.credential": "请求凭证",
			"settings.providerQuota.credentialCurrent": "当前供应商：{name}",
			"settings.providerQuota.credentialOther": "DSH 供应商：{name}",
			"settings.providerQuota.credentialRef": "高级：凭证引用 / 环境变量",
			"settings.providerQuota.credentialDirect": "直接填写 Token / Cookie（推荐）",
			"settings.providerQuota.credentialNone": "无需鉴权",
			"settings.providerQuota.endpoint": "额度接口 URL",
			"settings.requestMethod": "请求方法",
			"settings.directCredential": "Token / Cookie / Auth 凭证",
			"settings.directCredentialHint": "直接输入即可。保存到 DSH 本地凭证库，页面和配置接口都不会回显；再次输入并保存就是覆盖。",
			"settings.cookieCredentialHint": "只填写 Cookie 内容，不要包含“Cookie:”前缀。硅基流动网页接口通常还需要单独添加 x-subject-id 请求头。保存后原值不可查看，只能覆盖。",
			"settings.cookieCredentialPlaceholder": "例如：__SF_auth.session-token=…; other=value",
			"settings.directCredentialConfigured": "已设置（原值不可查看，只能覆盖）",
			"settings.directCredentialPlaceholder": "已设置；输入新值将覆盖",
			"settings.authHeader": "鉴权请求头名称",
			"settings.authParam": "鉴权参数名称",
			"settings.requestHeaders": "附加请求头",
			"settings.requestHeadersHint": "例如 x-subject-id。Cookie 请使用上面的 Cookie 鉴权，不要重复填在这里。",
			"settings.addHeader": "添加请求头",
			"settings.headerName": "请求头名称",
			"settings.headerValue": "请求头值",
			"settings.bodyType": "请求体类型",
			"settings.body": "请求体",
			"settings.bodyHint": "JSON 必须是对象；选择 JSON/Form 参数鉴权时，凭证会自动写入上方参数名，不要把秘密直接写进请求体。",
			"settings.body.none": "无请求体",
			"settings.body.json": "JSON",
			"settings.body.form": "表单（x-www-form-urlencoded）",
			"settings.body.raw": "原始文本",
			"settings.providerQuota.testParsed": "连接成功，解析到 {count} 项：{details}",
			"settings.providerQuota.testFields": "连接成功，读取到 {count} 个可选返回字段。请在下方选择需要展示的字段。",
			"settings.providerQuota.testFailedToast": "测试失败：{error}",
			"settings.providerQuota.copyDiagnostics": "复制诊断信息",
			"settings.providerQuota.diagnosticsCopied": "诊断信息已复制（Cookie、Token 等敏感凭证已脱敏）",
			"settings.providerQuota.copyDiagnosticsFailed": "复制失败，请手动选择错误详情",
			"settings.providerQuota.diagnosticStatus": "HTTP {status} {statusText}",
			"settings.providerQuota.diagnosticNoBody": "响应体为空",
			"settings.providerQuota.mapping": "返回字段映射",
			"settings.template.balance": "余额查询",
			"settings.template.subscription": "订阅套餐",
			"settings.template.add": "添加",
			"settings.template.added": "已添加",
			"settings.noCustomSources": "还没有添加其它额度源。",
			"settings.addCustomSource": "自定义接口",
			"settings.editCustomSource": "编辑额度源",
			"settings.customSourceHint": "绑定供应商 ID 后，切换到这些供应商会自动展示该额度。多个 ID 用逗号分隔。",
			"settings.templateSourceHint": "接口和解析规则由模板提供；通常只需确认凭证引用和绑定供应商。",
			"settings.edit": "编辑",
			"settings.remove": "移除",
			"settings.id": "ID / 标识",
			"settings.name": "名称",
			"settings.kind": "类型",
			"settings.kind.metric": "额度指标（HTTP 接口）",
			"settings.kind.usage": "订阅用量（多窗口）",
			"settings.kind.balance": "余额（多币种）",
			"settings.providerIds": "绑定供应商 ID",
			"settings.providerIdsHint": "例如 kimi、openrouter；多个用逗号分隔。切换供应商时会自动匹配。",
			"settings.providerPatterns": "匹配供应商正则（逗号分隔）",
			"settings.providerPatternsHint": "可选。支持正则，例如 my-provider-.*。",

			"settings.defaultSource": "默认展示源",
			"settings.quotaUrl": "接口 URL",
			"settings.quotaAuthRef": "凭证引用名",
			"settings.quotaAuthRefHint": "填写 DSH credentials 或环境变量中的名称，不要在这里粘贴密钥。",
			"settings.authStyle": "鉴权方式",
			"settings.auth.bearer": "Bearer Token",
			"settings.auth.token": "Authorization: Token",
			"settings.auth.basic": "Basic Auth（填写 user:password）",
			"settings.auth.header": "直接放入请求头",
			"settings.auth.cookie": "Cookie",
			"settings.auth.query": "URL 查询参数",
			"settings.auth.json": "JSON 请求体参数",
			"settings.auth.form": "Form 请求体参数",
			"settings.auth.none": "无需鉴权",
			"settings.metricLabel": "指标名称",
			"settings.metricValuePath": "剩余额度字段",
			"settings.metricValuePathHint": "接口直接返回剩余额度时选择此字段；如果只返回“已用额度 + 总额度”，这里留空。",
			"settings.metricUsedPath": "已用额度字段（可选）",
			"settings.metricUsedPathHint": "仅在需要用“总额度 − 已用额度”计算剩余时选择。",
			"settings.metricTotalPath": "总额度字段（可选）",
			"settings.metricTotalPathHint": "可用于展示总额度；与已用额度字段同时填写时，也可计算剩余额度。",
			"settings.metricUnit": "单位",
			"settings.metricUnitHint": "只影响展示，例如 CNY、USD、次或 Token。",
			"settings.metricResetPath": "重置时间字段（可选）",
			"settings.metricResetPathHint": "订阅套餐有重置时间时选择；普通余额通常留空。",
			"settings.metricMappingHint": "先测试接口，再为每个指标选择返回字段。可以直接读取“剩余额度”，也可以通过“总额度 − 已用额度”计算。未选择有效字段时不会再显示为 0。",
			"settings.metricAggregate": "多值处理（仅数组字段）",
			"settings.metricAggregateHint": "普通数字保持“直接取值”即可；只有所选字段返回数组时，才需要求和、计数、最小值或最大值。",
			"settings.metricAggregate.value": "直接取值（数组时取第一项）",
			"settings.metricAggregate.sum": "求和",
			"settings.metricAggregate.count": "计数",
			"settings.metricAggregate.min": "最小值",
			"settings.metricAggregate.max": "最大值",
			"settings.metricScale": "换算乘数",
			"settings.metricScaleHint": "最终值 = 原始值 × 换算乘数 + 加减偏移。例如 4609838000000 换算为 4.609838，可填写 0.000000000001（10⁻¹²）。",
			"settings.metricOffset": "加减偏移",
			"settings.metricOffsetHint": "在乘数换算后再加上的数值；通常保持 0。",
			"settings.addMetric": "添加展示指标",
			"settings.removeMetric": "删除指标",
			"settings.metricItem": "指标 {index}",
			"settings.metricValue": "数值",
			"settings.metricTotal": "总额",
			"settings.metricResetTime": "重置时间",
			"settings.btnCancel": "取消",
			"settings.btnTest": "测试并读取字段",
			"settings.btnTesting": "正在测试…",
			"settings.btnSaveSource": "保存额度源",
			"settings.testSuccess": "连接成功，已读取 {count} 个可选字段。",
			"settings.testSuccessTemplate": "连接成功，已解析 {count} 项：{details}",
			"settings.selectField": "请选择响应字段",
			"settings.testFirst": "先测试连接，成功后可直接选择返回字段。",
			"settings.advanced": "高级设置",
			"settings.customMappingHint": "有“剩余额度”就只选它；如果接口只返回“已用”和“总额”，选择后两项即可自动计算。",
			"settings.sourceSaved": "额度源已保存并立即生效",
			"settings.quotaSourceIdRequired": "请先填写额度源 ID。",
			"settings.serverIntervalHintQuota": "后台查询真实用量的频率。",
			"settings.warningPercent": "剩余额度预警阈值 (黄灯 🟡)",
			"settings.dangerPercent": "剩余额度告急阈值 (红灯 🔴)",
			"settings.warningHintQuota": "剩余低于此百分比亮黄灯。",
			"settings.dangerHintQuota": "剩余低于此百分比亮红灯。",
			"settings.serverIntervalHint": "后台查询真实余额的频率。",
			"settings.clientInterval": "前端读取缓存间隔",
			"settings.clientIntervalHint": "页面读取本地缓存的频率。",
			"settings.timeout": "请求超时（毫秒）",
			"settings.timeoutHint": "单次查询最长等待。",
			"settings.pricingHit": "缓存命中",
			"settings.pricingMiss": "未命中",
			"settings.pricingOut": "输出",
			"settings.pricingPeriod": "时段",
			"settings.pricingPeak": "高峰",
			"settings.pricingOffPeak": "低谷",
			"settings.pricingFlat": "固定",
			"settings.removeModel": "移除该模型",
			"settings.pricingReset": "恢复官方默认单价",
			"settings.addModel": "➕ 添加自定义模型",
			"settings.addModelName": "模型名称 (如 deepseek-chat)",
			"settings.addFillingPeak": "当前填写：高峰价",
			"settings.peakMultiplier": "峰谷倍率",
			"settings.addModelHint": "三个价格是高峰价。倍率为 1 时无峰谷；否则低谷 = 高峰 × 倍率（官方 V4 为 0.5）。",
			"settings.enableTiers": "按 0.5 启用峰谷",
			"settings.disableTiers": "改为固定价",
			"settings.btnAdd": "添加",
			"settings.btnCopy": "复制 YAML 配置",
			"settings.copied": "已复制到剪贴板",
			"settings.btnDiscard": "放弃修改",
			"settings.btnSave": "保存",
			"settings.saving": "保存中…",
			"settings.saveFailed": "本部署没有接受这些值，已保留供你修改。",
			"settings.savedToast": "✓ 设置已成功保存并立即生效",
			"spend.pill": "{range} {amount}",
			"spend.title": "累计消耗",
			"spend.today": "今天",
			"spend.yesterday": "昨天",
			"spend.week": "本周",
			"spend.month": "本月",
			"spend.custom": "自定义",
			"spend.from": "开始时间",
			"spend.to": "结束时间",
			"spend.meta": "{calls} 次调用 · {sessions} 个会话",
			"spend.empty": "该区间暂无消耗",
			"spend.open": "打开累计消耗",
			"spend.close": "收起"
		};
		const en = {
			"balance": "Balance {amount}",
			"balance.readoutCustom": "{name} · Balance {amount}",
			"balanceError": "Balance unavailable",
			"balanceMissing": "API key not configured",
			"status.sufficient": "Sufficient",
			"status.warning": "Low",
			"status.danger": "Critical",
			"btn.refresh": "Click to refresh balance",
			"btn.refreshing": "Refreshing balance...",
			"sessionCost": "~{amount} this session",
			"tps": "TPS {rate} tok/s",
			"card.balanceTitle": "📊 Account Balance",
			"card.sessionTitle": "⚡ Session Cost",
			"card.total": "Total: ",
			"card.wallet": "{currency} wallet",
			"card.topup": "Topped up {amount}",
			"card.granted": "Granted {amount}",
			"card.updated": "Updated {time} · Every {interval}",
			"card.refreshHint": "💡 Click the status light or card status/percent to refresh",
			"card.tokens": "Tokens: In {input} · Out {output}",
			"card.tokensHit": "Cache hit: {hit} ({hitRate}%)",
			"card.noCost": "No cost in this session yet",
			"card.pricingHint": "💡 View pricing & rates via [?]",
			"tariff.peak": "Liangwen Peak Time",
			"tariff.offPeak": "Liangwen Valley Time",
			"tariff.peakTitle": "Peak period: (Beijing time) Mon–Fri 09:00–12:00, 14:00–18:00\nValley period: all other times, including weekends",
			"tariff.offPeakTitle": "Peak period: (Beijing time) Mon–Fri 09:00–12:00, 14:00–18:00\nValley period: all other times, including weekends",
			"card.error": "【Account Balance】Error: {error}",
			/* OpenCode Go quota translations */
			"quota.readout": "Go quota M {monthly} · W {weekly} · 5h {rolling}",
			"quota.readoutCustom": "{name} · {windows}",
			"quota.cardTitle": "🧾 OpenCode Go Quota",
			"quota.remaining": "{percent} left",
			"quota.rolling": "5h rolling",
			"quota.weekly": "Weekly",
			"quota.monthly": "Monthly",
			"quota.resets": "Resets {time}",
			"quota.error": "【OpenCode Go Quota】Error: {error}",
			"quota.unavailable": "OpenCode Go quota unavailable",
			"btn.refreshQuota": "Click to refresh OpenCode Go quota",
			"btn.refreshingQuota": "Refreshing OpenCode Go quota...",
			"card.sessionHintQuota": "💡 Session cost uses configured prices; Go windows decide actual deductions.",
			"quota.cardTitleCustom": "🎯 Quota Usage",
			"quota.valueTotal": "{value} / {total} {unit} left",
			"quota.errorCustom": "【Quota Usage】Error: {error}",
			"quota.unavailableCustom": "Quota unavailable",
			"btn.refreshCustom": "Click to refresh quota",
			"btn.refreshingCustom": "Refreshing quota...",
			"card.sessionHintCustom": "💡 Session cost uses configured prices; actual deductions depend on the selected plan.",
			"pricing.title": "📋 DeepSeek V4 Pricing",
			"pricing.rateBadge": "Per 1M tokens · {currency}",
			"pricing.hit": "Hit {price}",
			"pricing.miss": "Miss {price}",
			"pricing.output": "Out {price}",
			"pricing.link": "View official pricing details ›",
			"pricing.aria": "View DeepSeek pricing",
			"model.unknown": "unknown model",
			"model.other": "other models",
			"unit.minutes": "{n} min",
			"unit.seconds": "{n} s",
			/* Settings translations */
			"settings.nav": "Credits",
			"settings.title": "Credits & spend",
			"settings.desc": "Bottom quota bar, spend capsule, and model pricing.",
			"settings.unsaved": "Unsaved",
			"settings.overridden": "Overridden",
			"settings.resetField": "Restore default",
			"settings.expand": "Show settings",
			"settings.collapse": "Hide settings",
			"settings.card.display": "Display",
			"settings.card.displayDesc": "Bottom bar, spend capsule, and hover card.",
			"settings.card.quota": "Quota source",
			"settings.card.quotaDesc": "Choose a quota source for each DSH provider; switching model providers shows its matching quota automatically.",
			"settings.card.thresholds": "Thresholds & refresh",
			"settings.card.thresholdsDesc": "Status-light thresholds and backend poll interval.",
			"settings.card.pricing": "Model pricing",
			"settings.card.pricingDesc": "Cache hit / miss / output price per 1M tokens. The three add-model fields are peak rates. Multiplier 1 means no peak/off-peak split; 0.5 means off-peak = peak × 0.5.",
			"settings.card.export": "YAML export",
			"settings.card.exportDesc": "Copy into cordis.patch.yml for a durable override.",
			"settings.enabled": "Enable quota features",
			"settings.enabledHint": "When off, hide quota, TPS, tariff badges, hover details, and spend tracking, and lock display, quota, thresholds, and refresh. Pricing and YAML export remain available.",
			"settings.showDock": "Bottom status bar",
			"settings.showDockHint": "Quota and session cost below the input.",
			"settings.dockLayout": "Status bar layout",
			"settings.dockLayout.own": "Own line",
			"settings.dockLayout.shared": "Share one line",
			"settings.dockLayoutHint": "Own row, or share the bottom stats row.",
			"settings.showCapsule": "Spend capsule",
			"settings.showCapsuleHint": "Draggable spend tracker in the corner.",
			"settings.showPopover": "Hover details",
			"settings.showPopoverHint": "Details when hovering the bottom readout.",
			"settings.showTps": "Live TPS",
			"settings.showTpsHint": "Show the live streaming generation speed.",
			"settings.quotaMode": "Quota query mode",
			"settings.quotaMode.follow": "Follow current model provider",
			"settings.quotaMode.custom": "Always show one quota source",
			"settings.quotaModeHint": "Automatic mode follows the current provider and uses the fallback below when unmatched.",
			"settings.currency": "Currency",
			"settings.currencyHint": "For session estimates and the status light.",
			"settings.currencyHintQuota": "Only affects the session estimate.",
			"settings.warning": "Warning Threshold (Yellow 🟡)",
			"settings.warningHint": "Yellow below this value.",
			"settings.danger": "Danger Threshold (Red 🔴)",
			"settings.dangerHint": "Red below this value.",
			"settings.sliderHint": "Drag or click the track to set the lines.",
			"settings.serverInterval": "Server Refresh Interval",
			"settings.provider": "Unmatched fallback",
			"settings.provider.deepseek": "DeepSeek official balance",
			"settings.provider.opencode": "OpenCode Go subscription usage",
			"settings.providerHintFollow": "Shown when the current provider has no matching quota source.",
			"settings.providerHintCustom": "Always shown in fixed mode.",
			"settings.opencodeApiKeyRef": "OpenCode Go Credential Ref",
			"settings.opencodeApiKeyRefHint": "Read from env or credentials.",
			"settings.opencodeApiKey": "OpenCode Go API Key",
			"settings.opencodeApiKeyHint": "Empty uses env or auth.json.",
			"settings.opencodeBaseUrl": "OpenCode Go Usage API",
			"settings.customSources": "Quota source templates",
			"settings.sourceSectionHint": "Match built-in DSH providers and reuse their credentials first; use an official template when no DSH match exists.",
			"settings.builtinSources": "Ready to select above:",
			"settings.dshDetected": "Prefer built-in DSH providers",
			"settings.dshReuse": "Reuse DSH credentials · {template}",
			"settings.dshReady": "Configured in DSH; reuse credentials · {template}",
			"settings.dshNotReady": "Built into DSH but not enabled; add the template first · {template}",
			"settings.dshCredential": "Credentials come from DSH provider:",
			"settings.dshCredentialPending": "This DSH provider is not enabled yet. Credentials will be reused after enabling it, or set a credential reference under Advanced:",
			"settings.providerQuota.intro": "Only enabled DSH providers and providers with an existing quota configuration are listed. Each provider is queried independently, so multiple OpenCode Go accounts never share a quota cache.",
			"settings.providerQuota.empty": "No DSH provider is enabled yet. Add and enable one in provider settings first.",
			"settings.providerQuota.enabled": "Show quota for this provider",
			"settings.providerQuota.hidden": "Quota hidden",
			"settings.providerQuota.configured": "Enabled in DSH",
			"settings.providerQuota.source": "Quota source",
			"settings.providerQuota.auto": "Auto detect (recommended)",
			"settings.providerQuota.template": "Built-in template",
			"settings.providerQuota.reuse": "Reuse another provider quota",
			"settings.providerQuota.custom": "Custom HTTP endpoint",
			"settings.providerQuota.autoSummary": "Auto · {template}",
			"settings.providerQuota.reuseSummary": "Reuse · {name}",
			"settings.providerQuota.autoHint": "Detect a template from provider ID and Base URL, then reuse the URL and key already saved in DSH.",
			"settings.providerQuota.templateHint": "The template owns the official endpoint and parser; credentials come from this DSH provider.",
			"settings.providerQuota.reuseHint": "Use this when two model providers actually share the same account and quota.",
			"settings.providerQuota.customHint": "Enter an endpoint, choose credentials, test it, then select response fields.",
			"settings.providerQuota.saveHint": "Changes are not saved automatically. Click Save to apply them.",
			"settings.providerQuota.templateSelect": "Built-in template",
			"settings.providerQuota.reuseSelect": "Quota comes from",
			"settings.providerQuota.credential": "Request credentials",
			"settings.providerQuota.credentialCurrent": "Current provider: {name}",
			"settings.providerQuota.credentialOther": "DSH provider: {name}",
			"settings.providerQuota.credentialRef": "Advanced: credential ref / environment variable",
			"settings.providerQuota.credentialDirect": "Enter token / cookie directly (recommended)",
			"settings.providerQuota.credentialNone": "No authentication",
			"settings.providerQuota.endpoint": "Quota endpoint URL",
			"settings.requestMethod": "HTTP method",
			"settings.directCredential": "Token / cookie / auth credential",
			"settings.directCredentialHint": "Enter it here. DSH stores it in the local credential vault and never returns it; enter a new value to overwrite it.",
			"settings.cookieCredentialHint": "Enter the cookie value only, without the “Cookie:” prefix. SiliconFlow's web endpoint usually also needs an x-subject-id header. Once saved, the value can only be overwritten.",
			"settings.cookieCredentialPlaceholder": "For example: __SF_auth.session-token=…; other=value",
			"settings.directCredentialConfigured": "Configured (the saved value cannot be viewed, only overwritten)",
			"settings.directCredentialPlaceholder": "Configured; enter a new value to overwrite",
			"settings.authHeader": "Authentication header",
			"settings.authParam": "Authentication parameter",
			"settings.requestHeaders": "Additional headers",
			"settings.requestHeadersHint": "For example x-subject-id. Use Cookie authentication above instead of adding Cookie here.",
			"settings.addHeader": "Add header",
			"settings.headerName": "Header name",
			"settings.headerValue": "Header value",
			"settings.bodyType": "Request body type",
			"settings.body": "Request body",
			"settings.bodyHint": "JSON must be an object. JSON/Form parameter authentication injects the credential using the parameter name above; do not put secrets in the body text.",
			"settings.body.none": "No body",
			"settings.body.json": "JSON",
			"settings.body.form": "Form (x-www-form-urlencoded)",
			"settings.body.raw": "Raw text",
			"settings.providerQuota.testParsed": "Connected. Parsed {count} item(s): {details}",
			"settings.providerQuota.testFields": "Connected. Read {count} selectable response field(s). Choose the fields to display below.",
			"settings.providerQuota.testFailedToast": "Test failed: {error}",
			"settings.providerQuota.copyDiagnostics": "Copy diagnostics",
			"settings.providerQuota.diagnosticsCopied": "Diagnostics copied (cookies, tokens, and other credentials were redacted)",
			"settings.providerQuota.copyDiagnosticsFailed": "Copy failed; select the error details manually",
			"settings.providerQuota.diagnosticStatus": "HTTP {status} {statusText}",
			"settings.providerQuota.diagnosticNoBody": "Empty response body",
			"settings.providerQuota.mapping": "Response field mapping",
			"settings.template.balance": "Balance queries",
			"settings.template.subscription": "Subscription plans",
			"settings.template.add": "Add",
			"settings.template.added": "Added",
			"settings.noCustomSources": "No additional quota sources yet.",
			"settings.addCustomSource": "Custom endpoint",
			"settings.editCustomSource": "Edit quota source",
			"settings.customSourceHint": "Bind provider IDs to display this quota automatically when switching providers. Separate multiple IDs with commas.",
			"settings.templateSourceHint": "The template owns the endpoint and response mapping. Usually you only need to confirm the credential and provider binding.",
			"settings.edit": "Edit",
			"settings.remove": "Remove",
			"settings.id": "ID",
			"settings.name": "Name",
			"settings.kind": "Kind",
			"settings.kind.metric": "Metric (HTTP endpoint)",
			"settings.kind.usage": "Usage (multi-window)",
			"settings.kind.balance": "Balance (multi-currency)",
			"settings.providerIds": "Bound provider IDs",
			"settings.providerIdsHint": "For example kimi or openrouter. Separate multiple IDs with commas; switching providers auto-matches them.",
			"settings.providerPatterns": "Provider patterns (comma separated)",
			"settings.providerPatternsHint": "Optional regex patterns, e.g. my-provider-.*",
			"settings.defaultSource": "Default source",
			"settings.quotaUrl": "API URL",
			"settings.quotaAuthRef": "Credential ref",
			"settings.quotaAuthRefHint": "Name of a DSH credential or environment variable. Do not paste the secret here.",
			"settings.authStyle": "Authentication",
			"settings.auth.bearer": "Bearer token",
			"settings.auth.token": "Authorization: Token",
			"settings.auth.basic": "Basic auth (enter user:password)",
			"settings.auth.header": "Raw header value",
			"settings.auth.cookie": "Cookie",
			"settings.auth.query": "URL query parameter",
			"settings.auth.json": "JSON body parameter",
			"settings.auth.form": "Form body parameter",
			"settings.auth.none": "No authentication",
			"settings.metricLabel": "Metric label",
			"settings.metricValuePath": "Remaining field",
			"settings.metricValuePathHint": "Select this when the API directly returns the remaining quota; leave it empty when only used and total values are available.",
			"settings.metricUsedPath": "Used field (optional)",
			"settings.metricUsedPathHint": "Only select this when remaining quota should be calculated as total minus used.",
			"settings.metricTotalPath": "Total field (optional)",
			"settings.metricTotalPathHint": "Displays the total quota and, together with the used field, can calculate the remaining quota.",
			"settings.metricUnit": "Unit",
			"settings.metricUnitHint": "Display only, for example CNY, USD, requests, or tokens.",
			"settings.metricResetPath": "Reset-time field (optional)",
			"settings.metricResetPathHint": "Select this for plans with a reset time; ordinary balances usually leave it empty.",
			"settings.metricMappingHint": "Test the endpoint first, then select response fields for each metric. Read a remaining value directly or calculate total minus used. An unconfigured field is no longer reported as zero.",
			"settings.metricAggregate": "Multiple-value handling (arrays only)",
			"settings.metricAggregateHint": "Keep Direct value for an ordinary number. Sum, count, minimum, and maximum only apply when the selected field returns an array.",
			"settings.metricAggregate.value": "Direct value (first item for arrays)",
			"settings.metricAggregate.sum": "Sum",
			"settings.metricAggregate.count": "Count",
			"settings.metricAggregate.min": "Minimum",
			"settings.metricAggregate.max": "Maximum",
			"settings.metricScale": "Conversion multiplier",
			"settings.metricScaleHint": "Final value = raw value × multiplier + offset. For example, convert 4609838000000 to 4.609838 with 0.000000000001 (10⁻¹²).",
			"settings.metricOffset": "Offset",
			"settings.metricOffsetHint": "Added after applying the multiplier; normally leave this at 0.",
			"settings.addMetric": "Add display metric",
			"settings.removeMetric": "Remove metric",
			"settings.metricItem": "Metric {index}",
			"settings.metricValue": "Value",
			"settings.metricTotal": "Total",
			"settings.metricResetTime": "Reset time",
			"settings.btnCancel": "Cancel",
			"settings.btnTest": "Test and read fields",
			"settings.btnTesting": "Testing…",
			"settings.btnSaveSource": "Save quota source",
			"settings.testSuccess": "Connected. Found {count} selectable fields.",
			"settings.testSuccessTemplate": "Connected. Parsed {count} item(s): {details}",
			"settings.selectField": "Select a response field",
			"settings.testFirst": "Test the connection to load response fields",
			"settings.advanced": "Advanced settings",
			"settings.customMappingHint": "Select Remaining when available. Otherwise select Used and Total, and the remaining value is calculated automatically.",
			"settings.sourceSaved": "Quota source saved and applied",
			"settings.quotaSourceIdRequired": "Please enter a quota source ID.",
			"settings.serverIntervalHintQuota": "How often the backend fetches usage.",
			"settings.warningPercent": "Remaining quota warning threshold (Yellow 🟡)",
			"settings.dangerPercent": "Remaining quota danger threshold (Red 🔴)",
			"settings.warningHintQuota": "Yellow below this remaining percent.",
			"settings.dangerHintQuota": "Red below this remaining percent.",
			"settings.serverIntervalHint": "How often the backend fetches the balance.",
			"settings.clientInterval": "Client Poll Interval",
			"settings.clientIntervalHint": "How often the page reads the local cache.",
			"settings.timeout": "Request timeout (ms)",
			"settings.timeoutHint": "Max wait for one quota request.",
			"settings.pricingHit": "Cache Hit",
			"settings.pricingMiss": "Cache Miss",
			"settings.pricingOut": "Output",
			"settings.pricingPeriod": "Period",
			"settings.pricingPeak": "Peak",
			"settings.pricingOffPeak": "Off-peak",
			"settings.pricingFlat": "Flat",
			"settings.removeModel": "Remove this model",
			"settings.pricingReset": "Reset to Default Rates",
			"settings.addModel": "➕ Add Custom Model",
			"settings.addModelName": "Model Name (e.g. deepseek-chat)",
			"settings.addFillingPeak": "Currently filling: peak",
			"settings.peakMultiplier": "Off-peak multiplier",
			"settings.addModelHint": "The three prices are peak rates. Multiplier 1 means no peak/off-peak split; otherwise off-peak = peak × multiplier (official V4 is 0.5).",
			"settings.enableTiers": "Enable peak/off-peak at 0.5",
			"settings.disableTiers": "Use flat rate",
			"settings.btnAdd": "Add",
			"settings.btnCopy": "Copy YAML",
			"settings.copied": "Copied to clipboard",
			"settings.btnDiscard": "Discard changes",
			"settings.btnSave": "Save",
			"settings.saving": "Saving…",
			"settings.saveFailed": "The deployment did not accept these values; they were left for you to correct.",
			"settings.savedToast": "✓ Settings saved and applied successfully",
			"spend.pill": "{range} {amount}",
			"spend.title": "Spend",
			"spend.today": "Today",
			"spend.yesterday": "Yesterday",
			"spend.week": "This week",
			"spend.month": "This month",
			"spend.custom": "Custom",
			"spend.from": "From",
			"spend.to": "To",
			"spend.meta": "{calls} calls · {sessions} sessions",
			"spend.empty": "No spend in this range",
			"spend.open": "Open spend tracker",
			"spend.close": "Collapse"
		};
		//#endregion

		//#region settings modal component
		const DEFAULT_PRICES_CNY = {
			"deepseek-v4-flash": v4SettingsFromTable(V4_CNY["deepseek-v4-flash"]),
			"deepseek-v4-pro": v4SettingsFromTable(V4_CNY["deepseek-v4-pro"]),
			"deepseek-chat": { cacheHit: 0.1, cacheMiss: 1, output: 2 },
			"deepseek-reasoner": { cacheHit: 1, cacheMiss: 4, output: 16 }
		};
		const DEFAULT_PRICES_USD = {
			"deepseek-v4-flash": v4SettingsFromTable(V4_USD["deepseek-v4-flash"]),
			"deepseek-v4-pro": v4SettingsFromTable(V4_USD["deepseek-v4-pro"]),
			"deepseek-chat": { cacheHit: 0.014, cacheMiss: 0.14, output: 0.28 },
			"deepseek-reasoner": { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19 }
		};
		const DEFAULT_PRICES = { ...DEFAULT_PRICES_CNY };

		function officialPricesFor(currency) {
			return currency === "CNY" ? DEFAULT_PRICES_CNY : DEFAULT_PRICES_USD;
		}
		function officialDefaultPrices(currency) {
			return currency === "CNY"
				? { cacheHit: 0.1, cacheMiss: 1, output: 2 }
				: { cacheHit: 0.014, cacheMiss: 0.14, output: 0.28 };
		}

		const DEFAULT_SETTINGS = {
			enabled: true,
			quotaMode: "follow",
			showDock: true,
			dockLayout: "own",
			showCapsule: true,
			showPopover: true,
			showTps: true,
			provider: "deepseek",
			currency: "CNY",
			warningThreshold: 10,
			dangerThreshold: 5,
			refreshIntervalMs: 300000,
			clientPollIntervalMs: 30000,
			timeoutMs: 8000,
			baseUrl: "https://api.deepseek.com",
			apiKey: "",
			opencodeApiKeyRef: "OPENCODE_GO_API_KEY",
			opencodeApiKey: "",
			opencodeBaseUrl: "https://opencode.ai/zen/go/v1/usage",
			prices: { ...DEFAULT_PRICES },
			defaultPrices: officialDefaultPrices("CNY"),
			quotaSources: [],
			providerQuotas: [],
			quotaTemplates: [],
			dshProviders: []
		};

		function generateYaml(config) {
			const providerQuotas = Array.isArray(config.providerQuotas) ? config.providerQuotas
				.filter((binding) => binding.implicit !== true || binding._edited === true)
				.map((binding) => {
					const clean = cloneSettings(binding);
					delete clean.adapterId;
					delete clean.implicit;
					delete clean.migrated;
					delete clean._edited;
					if (clean.source?.request) {
						delete clean.source.request.authValue;
						delete clean.source.request.credentialConfigured;
					}
					return clean;
				}) : [];
			const lines = [
				"- id: dsh-credits",
				"  config:",
				`    enabled: ${config.enabled !== false}`,
				`    showDock: ${config.showDock !== false}`,
				`    dockLayout: ${normalizeDockLayout(config.dockLayout)}`,
				`    showCapsule: ${config.showCapsule !== false}`,
				`    showPopover: ${config.showPopover !== false}`,
				`    showTps: ${config.showTps !== false}`,
				...(providerQuotas.length > 0
					? [`    providerQuotas: ${JSON.stringify(providerQuotas)}`]
					: []),
				`    dangerThreshold: ${config.dangerThreshold}`,
				`    warningThreshold: ${config.warningThreshold}`,
				`    refreshIntervalMs: ${config.refreshIntervalMs}`,
				`    clientPollIntervalMs: ${config.clientPollIntervalMs}`,
				`    currency: ${config.currency}`
			];
			lines.push("    prices:");
			for (const [m, p] of Object.entries(config.prices || {})) {
				if (hasTariffTiers(p)) {
					lines.push(`      ${m}: { cacheHit: ${p.cacheHit}, cacheMiss: ${p.cacheMiss}, output: ${p.output}, peak: { cacheHit: ${p.peak.cacheHit}, cacheMiss: ${p.peak.cacheMiss}, output: ${p.peak.output} }, offPeak: { cacheHit: ${p.offPeak.cacheHit}, cacheMiss: ${p.offPeak.cacheMiss}, output: ${p.offPeak.output} } }`);
				} else {
					lines.push(`      ${m}: { cacheHit: ${p.cacheHit}, cacheMiss: ${p.cacheMiss}, output: ${p.output} }`);
				}
			}
			return lines.join("\n");
		}

		/**
		 * 交互式双滑块阈值调节条组件 (带点击与拖拽手柄)
		 */
		function InteractiveThresholdSlider({ danger, warning, currency, onChange, t, percentMode }) {
			const maxScale = react.useMemo(() => {
				if (percentMode) return 100;
				const base = currency === "USD" ? 10 : 50;
				return Math.max(base, Math.ceil(warning * 1.3));
			}, [currency, warning, percentMode]);

			const fmt = (v) => percentMode ? Math.round(v * 10) / 10 + "%" : formatMoney(v, currency);
			const pctDanger = Math.min(100, Math.max(0, (danger / maxScale) * 100));
			const pctWarning = Math.min(100, Math.max(pctDanger, (warning / maxScale) * 100));

			const trackRef = react.useRef(null);
			const [dragging, setDragging] = react.useState(null);

			react.useEffect(() => {
				if (!dragging) return;
				const handlePointerMove = (e) => {
					if (!trackRef.current) return;
					const rect = trackRef.current.getBoundingClientRect();
					const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
					const ratio = x / rect.width;
					const rawVal = Math.round(ratio * maxScale * 10) / 10;
					if (dragging === "danger") {
						const nextDanger = Math.max(0, Math.min(warning, rawVal));
						onChange(nextDanger, warning);
					} else if (dragging === "warning") {
						const nextWarning = Math.max(danger, Math.min(maxScale, rawVal));
						onChange(danger, nextWarning);
					}
				};
				const handlePointerUp = () => setDragging(null);
				window.addEventListener("pointermove", handlePointerMove);
				window.addEventListener("pointerup", handlePointerUp);
				return () => {
					window.removeEventListener("pointermove", handlePointerMove);
					window.removeEventListener("pointerup", handlePointerUp);
				};
			}, [dragging, danger, warning, maxScale, onChange]);

			const handleTrackClick = (e) => {
				if (!trackRef.current) return;
				const rect = trackRef.current.getBoundingClientRect();
				const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
				const ratio = x / rect.width;
				const clickVal = Math.round(ratio * maxScale * 10) / 10;
				const distDanger = Math.abs(clickVal - danger);
				const distWarning = Math.abs(clickVal - warning);
				if (distDanger < distWarning) {
					onChange(Math.max(0, Math.min(warning, clickVal)), warning);
				} else {
					onChange(danger, Math.max(danger, clickVal));
				}
			};

			return react.createElement("div", { className: "dshqb_slider_box", key: "slider_box" }, [
				react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, t("settings.sliderHint")),
				react.createElement("div", {
					className: "dshqb_slider_track_wrap",
					ref: trackRef,
					onClick: handleTrackClick,
					key: "track_wrap"
				}, [
					// 轨道背景与三色分区
					react.createElement("div", { className: "dshqb_slider_track", key: "track" }, [
						react.createElement("div", {
							className: "dshqb_slider_fill_danger",
							style: { width: pctDanger + "%" },
							key: "fill_danger"
						}),
						react.createElement("div", {
							className: "dshqb_slider_fill_warning",
							style: { left: pctDanger + "%", width: (pctWarning - pctDanger) + "%" },
							key: "fill_warning"
						}),
						react.createElement("div", {
							className: "dshqb_slider_fill_success",
							style: { left: pctWarning + "%", width: (100 - pctWarning) + "%" },
							key: "fill_success"
						})
					]),
					// 告急手柄 🔴
					react.createElement("div", {
						className: "dshqb_slider_handle dshqb_slider_handle_danger",
						style: { left: pctDanger + "%" },
						onPointerDown: (e) => {
							e.stopPropagation();
							setDragging("danger");
						},
						key: "handle_danger",
						title: "告急阈值: " + fmt(danger)
					}, [
						react.createElement("span", { className: "dshqb_slider_badge", key: "badge" }, "🔴 " + fmt(danger))
					]),
					// 预警手柄 🟡
					react.createElement("div", {
						className: "dshqb_slider_handle dshqb_slider_handle_warning",
						style: { left: pctWarning + "%" },
						onPointerDown: (e) => {
							e.stopPropagation();
							setDragging("warning");
						},
						key: "handle_warning",
						title: "预警阈值: " + fmt(warning)
					}, [
						react.createElement("span", { className: "dshqb_slider_badge", key: "badge" }, "🟡 " + fmt(warning))
					])
				]),
				// 刻度说明
				react.createElement("div", { className: "dshqb_slider_legend", key: "legend" }, [
					react.createElement("span", { key: "l0" }, fmt(0)),
					react.createElement("span", { key: "ld" }, "🔴 告急线"),
					react.createElement("span", { key: "lw" }, "🟡 预警线"),
					react.createElement("span", { key: "ls" }, "🟢 充足区间"),
					react.createElement("span", { key: "lmax" }, fmt(maxScale) + (percentMode ? "" : "+"))
				])
			]);
		}

		function cloneSettings(form) {
			return JSON.parse(JSON.stringify(form));
		}

		function configToForm(c) {
			const loadedPrices = (c.prices && Object.keys(c.prices).length > 0) ? { ...c.prices } : { ...DEFAULT_PRICES };
			return {
				enabled: c.enabled !== false,
				quotaMode: c.quotaMode === "custom" ? "custom" : "follow",
				showDock: c.showDock !== false,
				dockLayout: normalizeDockLayout(c.dockLayout),
				showCapsule: c.showCapsule !== false,
				showPopover: c.showPopover !== false,
				showTps: c.showTps !== false,
				provider: typeof c.provider === "string" && c.provider.trim() ? c.provider.trim() : "deepseek",
				currency: c.currency ?? "CNY",
				warningThreshold: c.warningThreshold ?? 10,
				dangerThreshold: c.dangerThreshold ?? 5,
				refreshIntervalMs: c.refreshIntervalMs ?? 300000,
				clientPollIntervalMs: c.clientPollIntervalMs ?? 30000,
				timeoutMs: c.timeoutMs ?? 8000,
				baseUrl: c.baseUrl ?? "https://api.deepseek.com",
				apiKey: "",
				opencodeApiKeyRef: c.opencodeApiKeyRef || "OPENCODE_GO_API_KEY",
				opencodeApiKey: "",
				opencodeBaseUrl: c.opencodeBaseUrl || "https://opencode.ai/zen/go/v1/usage",
				prices: hydratePrices(loadedPrices, c.currency ?? "CNY"),
				defaultPrices: c.defaultPrices ?? officialDefaultPrices(c.currency ?? "CNY"),
				quotaSources: Array.isArray(c.quotaSources) ? c.quotaSources.map((s) => cloneSettings(s)) : [],
				providerQuotas: Array.isArray(c.providerQuotas) ? c.providerQuotas.map((binding) => cloneSettings(binding)) : [],
				quotaTemplates: Array.isArray(c.quotaTemplates) ? c.quotaTemplates.map((item) => cloneSettings(item)) : [],
				dshProviders: Array.isArray(c.dshProviders) ? c.dshProviders.map((item) => cloneSettings(item)) : []
			};
		}

		const CARD_IDS = ["display", "quota", "thresholds", "pricing"];
		const CARD_KEYS = {
			display: ["showDock", "dockLayout", "showCapsule", "showPopover", "showTps"],
			quota: ["providerQuotas"],
			thresholds: ["warningThreshold", "dangerThreshold", "refreshIntervalMs", "clientPollIntervalMs", "timeoutMs"],
			pricing: ["currency", "prices", "defaultPrices"]
		};
		const SECRET_FIELDS = ["apiKey", "opencodeApiKey"];
		const SETTINGS_DRAFT_PREFIX = "dsh-credits.settingsDraft.";

		function mergeView(baseline, drafts) {
			const next = cloneSettings(baseline || DEFAULT_SETTINGS);
			for (const cardId of CARD_IDS) {
				const overlay = drafts?.[cardId];
				if (!overlay || typeof overlay !== "object") continue;
				for (const [key, value] of Object.entries(overlay)) next[key] = value;
			}
			return next;
		}

		function valuesEqual(field, a, b) {
			if (field === "prices") {
				const pa = {};
				const pb = {};
				for (const [model, rates] of Object.entries(a || {})) pa[model] = snapshotModelPrice(rates);
				for (const [model, rates] of Object.entries(b || {})) pb[model] = snapshotModelPrice(rates);
				return JSON.stringify(pa) === JSON.stringify(pb);
			}
			if (field === "defaultPrices") return JSON.stringify(a || {}) === JSON.stringify(b || {});
			if ((a && typeof a === "object") || (b && typeof b === "object")) return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
			if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
			if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
			return String(a ?? "") === String(b ?? "");
		}

		function schemaDefault(field, currency) {
			if (field === "prices") return { ...officialPricesFor(currency || "CNY") };
			if (field === "defaultPrices") return officialDefaultPrices(currency || "CNY");
			if (field === "dockLayout") return "own";
			return DEFAULT_SETTINGS[field];
		}

		function isSchemaOverridden(field, value, currency) {
			if (SECRET_FIELDS.includes(field)) return String(value ?? "").trim() !== "";
			return !valuesEqual(field, value, schemaDefault(field, currency));
		}

		function pricesEqualModel(a, b) {
			return JSON.stringify(snapshotModelPrice(a)) === JSON.stringify(snapshotModelPrice(b));
		}

		function overlayWithoutSecrets(overlay) {
			if (!overlay || typeof overlay !== "object") return overlay;
			const next = cloneSettings(overlay);
			for (const key of SECRET_FIELDS) delete next[key];
			if (Array.isArray(next.quotaSources)) {
				next.quotaSources = next.quotaSources.map((source) => ({
					...source,
					request: {
						...(source.request ?? {}),
						authValue: "",
						headers: Object.fromEntries(
							Object.entries(source.request?.headers ?? {})
								.map(([k, v]) => [k, /authorization|token|api[-_]?key|secret|cookie|session/i.test(k) ? "***" : v]),
						),
					},
				}));
			}
			if (Array.isArray(next.providerQuotas)) {
				next.providerQuotas = next.providerQuotas.map((binding) => ({
					...binding,
					...(binding?.source ? {
						source: {
							...binding.source,
							request: {
								...(binding.source.request ?? {}),
								authValue: "",
								headers: Object.fromEntries(
									Object.entries(binding.source.request?.headers ?? {})
										.map(([k, v]) => [k, /authorization|token|api[-_]?key|secret|cookie|session/i.test(k) ? "***" : v]),
								),
							},
						},
					} : {}),
				}));
			}
			return next;
		}

		function isCardDirty(cardId, overlay, baseline) {
			if (!overlay || typeof overlay !== "object") return false;
			const keys = Object.keys(overlay);
			if (keys.length === 0) return false;
			for (const key of keys) {
				if (!valuesEqual(key, overlay[key], baseline?.[key])) return true;
			}
			return false;
		}

		const settingsDraftMem = {
			hydrated: false,
			baseline: null,
			drafts: { display: null, quota: null, thresholds: null, pricing: null },
			open: { display: false, quota: false, thresholds: false, pricing: false, export: false }
		};

		function readSessionDraft() {
			try {
				if (typeof sessionStorage === "undefined") return null;
				const raw = sessionStorage.getItem(SETTINGS_DRAFT_PREFIX + "state");
				if (!raw) return null;
				const parsed = JSON.parse(raw);
				if (!parsed || typeof parsed !== "object" || !parsed.baseline) return null;
				return {
					baseline: parsed.baseline,
					drafts: parsed.drafts && typeof parsed.drafts === "object" ? parsed.drafts : {},
					open: parsed.open && typeof parsed.open === "object" ? parsed.open : {}
				};
			} catch {
				return null;
			}
		}

		function persistSessionDraft() {
			try {
				if (typeof sessionStorage === "undefined") return;
				const drafts = {};
				let dirty = false;
				for (const cardId of CARD_IDS) {
					const overlay = overlayWithoutSecrets(settingsDraftMem.drafts[cardId]);
					if (overlay && isCardDirty(cardId, overlay, settingsDraftMem.baseline)) {
						drafts[cardId] = overlay;
						dirty = true;
					}
				}
				if (!settingsDraftMem.hydrated || !dirty || !settingsDraftMem.baseline) {
					sessionStorage.removeItem(SETTINGS_DRAFT_PREFIX + "state");
					return;
				}
				sessionStorage.setItem(SETTINGS_DRAFT_PREFIX + "state", JSON.stringify({
					baseline: overlayWithoutSecrets(settingsDraftMem.baseline),
					drafts,
					open: settingsDraftMem.open
				}));
			} catch { /* ignore quota / private mode */ }
		}

		function bootSettingsDraft() {
			if (settingsDraftMem.baseline) {
				return {
					baseline: settingsDraftMem.baseline,
					drafts: settingsDraftMem.drafts,
					open: settingsDraftMem.open
				};
			}
			const session = readSessionDraft();
			if (session) {
				settingsDraftMem.baseline = session.baseline;
				settingsDraftMem.drafts = { display: null, quota: null, thresholds: null, pricing: null, ...session.drafts };
				settingsDraftMem.open = { display: false, quota: false, thresholds: false, pricing: false, export: false, ...session.open };
				for (const cardId of CARD_IDS) {
					if (isCardDirty(cardId, settingsDraftMem.drafts[cardId], settingsDraftMem.baseline)) {
						settingsDraftMem.open[cardId] = true;
					}
				}
				settingsDraftMem.hydrated = true;
				return {
					baseline: settingsDraftMem.baseline,
					drafts: settingsDraftMem.drafts,
					open: settingsDraftMem.open
				};
			}
			settingsDraftMem.baseline = cloneSettings(DEFAULT_SETTINGS);
			return {
				baseline: settingsDraftMem.baseline,
				drafts: settingsDraftMem.drafts,
				open: settingsDraftMem.open
			};
		}

		function FieldRow({ t, label, hint, overridden, onReset, disabled, trailing, wide, children }) {
			return react.createElement("div", { className: "dshqb_field" + (wide ? " dshqb_field_full" : "") }, [
				react.createElement("div", { className: "dshqb_field_head", key: "head" }, [
					react.createElement("span", { className: "dshqb_field_label", key: "label" }, label),
					overridden ? react.createElement("span", { className: "dshqb_field_badges", key: "badges" }, [
						react.createElement("span", { className: "dshqb_field_badge", key: "ov" }, t("settings.overridden")),
						react.createElement("button", {
							type: "button",
							className: "dshqb_field_reset",
							disabled,
							onClick: (e) => {
								e.preventDefault();
								e.stopPropagation();
								onReset();
							},
							key: "reset"
						}, t("settings.resetField"))
					]) : null,
					trailing || null
				]),
				children || null,
				hint ? react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, hint) : null
			]);
		}

		function FieldGrid({ children }) {
			return react.createElement("div", { className: "dshqb_field_grid" }, children);
		}

		function SwitchControl({ checked, disabled, onChange, label, large }) {
			return react.createElement("label", {
				className: "dshqb_switch" + (large ? " dshqb_switch_large" : ""),
				title: label
			}, [
				react.createElement("input", {
					type: "checkbox",
					className: "dshqb_switch_input",
					checked,
					disabled,
					onChange,
					"aria-label": label,
					key: "input"
				}),
				react.createElement("span", { className: "dshqb_switch_track", "aria-hidden": "true", key: "track" })
			]);
		}

		function HoverTooltip({ content, children, className = "" }) {
			return react.createElement("span", { className: "dshqb_hover_tip_wrap" + (className ? " " + className : "") }, [
				children,
				react.createElement("span", { className: "dshqb_hover_tip", role: "tooltip", key: "tip" }, content)
			]);
		}

		function PluginCard({ t, title, description, dirty, open, onToggle, saving, failed, onDiscard, onSave, hideFooter, children }) {
			const blocked = !dirty || saving;
			return react.createElement("li", {
				className: "dshqb_pcard" + (open ? " dshqb_pcard_open" : "")
			}, [
				react.createElement("button", {
					type: "button",
					className: "dshqb_pcard_header",
					"aria-expanded": open,
					"aria-label": t(open ? "settings.collapse" : "settings.expand") + ": " + title,
					onClick: onToggle,
					key: "hdr"
				}, [
					react.createElement("span", { className: "dshqb_pcard_head_text", key: "txt" }, [
						react.createElement("span", { className: "dshqb_pcard_name", key: "n" }, title),
						react.createElement("span", { className: "dshqb_pcard_desc", key: "d" }, description)
					]),
					dirty ? react.createElement("span", { className: "dshqb_unsaved", key: "unsaved" }, t("settings.unsaved")) : null,
					react.createElement("span", {
						className: "dshqb_pcard_chevron" + (open ? " dshqb_pcard_chevron_open" : ""),
						"aria-hidden": "true",
						key: "ch"
					}, "▾")
				]),
				open ? react.createElement("div", { className: "dshqb_pcard_body", key: "body" }, [
					children,
					hideFooter ? null : react.createElement("div", { className: "dshqb_pcard_footer", key: "ftr" }, [
						failed ? react.createElement("p", { className: "dshqb_pcard_failed", role: "status", key: "fail" }, t("settings.saveFailed")) : null,
						react.createElement("button", {
							type: "button",
							className: "dshqb_btn dshqb_btn_outline",
							disabled: !dirty || saving,
							onClick: (e) => {
								e.preventDefault();
								e.stopPropagation();
								onDiscard();
							},
							key: "discard"
						}, t("settings.btnDiscard")),
						react.createElement("button", {
							type: "button",
							className: "dshqb_btn dshqb_btn_primary",
							disabled: blocked,
							onClick: (e) => {
								e.preventDefault();
								e.stopPropagation();
								onSave();
							},
							key: "save"
						}, t(saving ? "settings.saving" : "settings.btnSave"))
					])
				]) : null
			]);
		}

		function SettingsPanel({ t }) {
			const boot = react.useMemo(() => bootSettingsDraft(), []);
			const [baseline, setBaseline] = react.useState(boot.baseline);
			const [drafts, setDrafts] = react.useState(boot.drafts);
			const [open, setOpen] = react.useState(boot.open);
			const [savingCard, setSavingCard] = react.useState(null);
			const [failedCard, setFailedCard] = react.useState(null);
			const [toast, setToast] = react.useState(null);
			const [copied, setCopied] = react.useState(false);
			const [savingEnabled, setSavingEnabled] = react.useState(false);
			const [enabledOverride, setEnabledOverride] = react.useState(null);
			const [newModelName, setNewModelName] = react.useState("");
			const [newModelHit, setNewModelHit] = react.useState(0.1);
			const [newModelMiss, setNewModelMiss] = react.useState(1.0);
			const [newModelOut, setNewModelOut] = react.useState(2.0);
			const [newModelMultiplier, setNewModelMultiplier] = react.useState(1);
			const [customSourceDraft, setCustomSourceDraft] = react.useState(null);
			const [editingSourceId, setEditingSourceId] = react.useState(null);
			const [editingProviderId, setEditingProviderId] = react.useState(null);
			const [customSourceError, setCustomSourceError] = react.useState("");
			const [sourceTest, setSourceTest] = react.useState({ state: "idle", fields: [], message: "" });

			const baseView = mergeView(baseline, drafts);
			const view = enabledOverride === null ? baseView : { ...baseView, enabled: enabledOverride };
			const quotaEnabled = view.enabled !== false;
			const dirtyOf = (cardId) => isCardDirty(cardId, drafts[cardId], baseline);

			const commitMem = (nextBaseline, nextDrafts, nextOpen) => {
				if (nextBaseline !== undefined) settingsDraftMem.baseline = nextBaseline;
				if (nextDrafts !== undefined) settingsDraftMem.drafts = nextDrafts;
				if (nextOpen !== undefined) settingsDraftMem.open = nextOpen;
				persistSessionDraft();
			};

			const patchCard = (cardId, patch) => {
				setDrafts((prev) => {
					const current = { ...(prev[cardId] || {}) };
					for (const [key, value] of Object.entries(patch)) {
						if (valuesEqual(key, value, baseline[key])) delete current[key];
						else current[key] = value;
					}
					const nextDrafts = { ...prev, [cardId]: Object.keys(current).length ? current : null };
					commitMem(undefined, nextDrafts, undefined);
					return nextDrafts;
				});
				setFailedCard((id) => id === cardId ? null : id);
			};

			const resetField = (cardId, field) => {
				const currency = field === "prices" || field === "defaultPrices" ? view.currency : view.currency;
				patchCard(cardId, { [field]: schemaDefault(field, currency) });
			};

			const toggleOpen = (cardId) => {
				setOpen((prev) => {
					const next = { ...prev, [cardId]: !prev[cardId] };
					commitMem(undefined, undefined, next);
					return next;
				});
			};

			react.useEffect(() => {
				let cancelled = false;
				fetch("/query-credits/config", { cache: "no-store" })
					.then((r) => r.json())
					.then((data) => {
						if (cancelled || !data || !data.ok || !data.config) return;
						const loaded = configToForm(data.config);
						const memBase = settingsDraftMem.baseline;
						const keep = memBase && JSON.stringify(overlayWithoutSecrets(loaded)) === JSON.stringify(overlayWithoutSecrets(memBase));
						const nextBase = keep ? memBase : loaded;
						const nextDrafts = keep ? settingsDraftMem.drafts : { display: null, quota: null, thresholds: null, pricing: null };
						const nextOpen = { ...settingsDraftMem.open };
						if (!keep) {
							nextOpen.display = false;
							nextOpen.quota = false;
							nextOpen.thresholds = false;
							nextOpen.pricing = false;
						} else {
							for (const cardId of CARD_IDS) {
								if (isCardDirty(cardId, nextDrafts[cardId], nextBase)) nextOpen[cardId] = true;
							}
						}
						settingsDraftMem.baseline = nextBase;
						settingsDraftMem.drafts = nextDrafts;
						settingsDraftMem.open = nextOpen;
						settingsDraftMem.hydrated = true;
						persistSessionDraft();
						setBaseline(nextBase);
						setDrafts(nextDrafts);
						setOpen(nextOpen);
					})
					.catch(() => {});
				return () => { cancelled = true; };
			}, []);

			const showToast = (msg, tone = "success", durationMs = 2500) => {
				const nextToast = { message: msg, tone };
				setToast(nextToast);
				setTimeout(() => setToast((current) => current === nextToast ? null : current), durationMs);
			};
			const copyTestDiagnostics = async (message, diagnostics) => {
				try {
					if (!globalThis.navigator?.clipboard?.writeText) throw new Error("clipboard unavailable");
					await globalThis.navigator.clipboard.writeText(JSON.stringify({ error: message, ...diagnostics }, null, 2));
					showToast(t("settings.providerQuota.diagnosticsCopied"));
				} catch (_error) {
					showToast(t("settings.providerQuota.copyDiagnosticsFailed"), "error");
				}
			};

			const discardCard = (cardId) => {
				setDrafts((prev) => {
					const nextDrafts = { ...prev, [cardId]: null };
					commitMem(undefined, nextDrafts, undefined);
					return nextDrafts;
				});
				setFailedCard((id) => id === cardId ? null : id);
			};

			const setGlobalEnabled = async (nextEnabled) => {
				if (savingEnabled) return;
				setEnabledOverride(nextEnabled);
				setSavingEnabled(true);
				try {
					const res = await fetch("/query-credits/config", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ enabled: nextEnabled })
					});
					const data = await res.json();
					if (!data.ok) throw new Error("save failed");
					const nextBase = { ...baseline, enabled: nextEnabled };
					settingsDraftMem.baseline = nextBase;
					settingsDraftMem.hydrated = true;
					persistSessionDraft();
					setBaseline(nextBase);
					setEnabledOverride(null);
					showToast(t("settings.savedToast"));
					void balanceStore.forceRefresh();
					void spendStore.refresh();
				} catch (_err) {
					setEnabledOverride(null);
					showToast(t("settings.saveFailed"), "error");
				} finally {
					setSavingEnabled(false);
				}
			};

			const saveCard = async (cardId) => {
				if ((!quotaEnabled && cardId !== "pricing") || !dirtyOf(cardId) || savingCard) return;
				setSavingCard(cardId);
				setFailedCard(null);
				const merged = mergeView(baseline, { ...drafts, [cardId]: drafts[cardId] });
				const payload = {};
				try {
					if (cardId === "display") {
						payload.showDock = merged.showDock !== false;
						payload.dockLayout = normalizeDockLayout(merged.dockLayout);
						payload.showCapsule = merged.showCapsule !== false;
						payload.showPopover = merged.showPopover !== false;
						payload.showTps = merged.showTps !== false;
					} else if (cardId === "quota") {
						payload.providerQuotas = Array.isArray(merged.providerQuotas)
							? merged.providerQuotas.filter((binding) => binding.implicit !== true || binding._edited === true).map((binding) => {
								const clean = cloneSettings(binding);
								delete clean.adapterId;
								delete clean.implicit;
								delete clean.migrated;
								delete clean._edited;
								return clean;
							})
							: [];
					} else if (cardId === "thresholds") {
						payload.warningThreshold = Number(merged.warningThreshold);
						payload.dangerThreshold = Number(merged.dangerThreshold);
						payload.refreshIntervalMs = Number(merged.refreshIntervalMs);
						payload.clientPollIntervalMs = Number(merged.clientPollIntervalMs);
						payload.timeoutMs = Number(merged.timeoutMs);
					} else if (cardId === "pricing") {
						payload.currency = String(merged.currency ?? "CNY").trim().toUpperCase();
						payload.prices = { ...(merged.prices || {}) };
						payload.defaultPrices = { ...(merged.defaultPrices || officialDefaultPrices(merged.currency)) };
					}
					const res = await fetch("/query-credits/config", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(payload)
					});
					const data = await res.json();
					if (data.ok) {
						const nextBase = data.config ? configToForm(data.config) : cloneSettings(baseline);
						if (!data.config) {
							for (const [key, value] of Object.entries(payload)) {
								if (SECRET_FIELDS.includes(key)) continue;
								nextBase[key] = value;
							}
						}
						const nextDrafts = { ...drafts, [cardId]: null };
						settingsDraftMem.baseline = nextBase;
						settingsDraftMem.drafts = nextDrafts;
						settingsDraftMem.hydrated = true;
						persistSessionDraft();
						setBaseline(nextBase);
						setDrafts(nextDrafts);
						showToast(t("settings.savedToast"));
						void balanceStore.forceRefresh();
						void spendStore.refresh();
					} else {
						setFailedCard(cardId);
					}
				} catch (_err) {
					setFailedCard(cardId);
				} finally {
					setSavingCard(null);
				}
			};

			const handleCopyYaml = () => {
				const yaml = generateYaml(view);
				if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(yaml).then(() => {
						setCopied(true);
						showToast(t("settings.copied"));
						setTimeout(() => setCopied(false), 2000);
					});
				}
			};

			const quotaTemplates = Array.isArray(view.quotaTemplates) ? view.quotaTemplates : [];
			const dshProviderDirectory = Array.isArray(view.dshProviders) ? view.dshProviders : [];
			const currency = view.currency ?? "CNY";
			const providerQuotaBindings = Array.isArray(view.providerQuotas) ? view.providerQuotas : [];
			const percentMode = providerQuotaBindings.some((binding) => {
				if (binding.enabled === false || binding.sourceType === "custom") return false;
				const provider = dshProviderDirectory.find((item) => item.id === binding.providerId);
				const templateId = binding.sourceType === "template" ? binding.templateId : (provider?.templateId || binding.templateId);
				return quotaTemplates.find((template) => template.id === templateId)?.category === "subscription";
			});
			const providerBindingFor = (providerId) => providerQuotaBindings.find((binding) => binding.providerId === providerId) ?? null;
			const visibleDshProviders = dshProviderDirectory.filter((provider) => {
				const binding = providerBindingFor(provider.id);
				return provider.configured === true || (binding && binding.implicit !== true);
			});
			const safeProviderSourceId = (providerId) => {
				const suffix = String(providerId ?? "provider").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "provider";
				return ("quota-" + suffix).slice(0, 64);
			};
			const emptyProviderCustomSource = (provider) => ({
				id: safeProviderSourceId(provider.id),
				name: (provider.name || provider.id) + " 额度",
				kind: "metric",
				template: "",
				providerIds: [provider.id],
				providerPatterns: [],
				enabled: true,
				request: { method: "GET", url: "", dshProvider: "", credentialMode: "direct", authRef: "", authValue: "", credentialConfigured: false, authStyle: "bearer", authHeader: "Authorization", authParam: "api_key", headers: {}, bodyType: "none", body: "" },
				response: {
					metrics: [{ key: "remaining", label: "剩余额度", valuePath: "", usedPath: "", totalPath: "", unit: "", resetsAtPath: "", aggregate: "value", scale: 1, offset: 0 }],
				},
			});
			const defaultProviderBinding = (provider) => ({
				providerId: provider.id,
				enabled: provider.quotaSupported === true && provider.quotaAutoEnabled !== false,
				sourceType: provider.quotaSupported === true ? "auto" : "custom",
				templateId: provider.templateId || "",
				sourceProviderId: "",
				...(provider.quotaSupported === true ? {} : { source: emptyProviderCustomSource(provider) }),
			});
			const updateProviderBinding = (provider, patchOrUpdater, preserveTestFields = false) => {
				const current = cloneSettings(providerBindingFor(provider.id) ?? defaultProviderBinding(provider));
				const patch = typeof patchOrUpdater === "function" ? patchOrUpdater(current) : patchOrUpdater;
				const nextBinding = { ...current, ...patch, providerId: provider.id, _edited: true };
				const next = providerQuotaBindings.some((binding) => binding.providerId === provider.id)
					? providerQuotaBindings.map((binding) => binding.providerId === provider.id ? nextBinding : cloneSettings(binding))
					: [...providerQuotaBindings.map((binding) => cloneSettings(binding)), nextBinding];
				patchCard("quota", { providerQuotas: next });
				if (preserveTestFields) {
					setSourceTest((current) => current.providerId === provider.id
						? { ...current, state: "idle", message: "", diagnostics: null }
						: current);
				} else {
					setSourceTest({ state: "idle", fields: [], message: "", providerId: provider.id });
				}
			};
			const providerSourceLabel = (provider, binding) => {
				if (!binding || binding.enabled === false) return t("settings.providerQuota.hidden");
				if (binding.sourceType === "provider") {
					const target = dshProviderDirectory.find((item) => item.id === binding.sourceProviderId);
					return t("settings.providerQuota.reuseSummary", { name: target?.name || binding.sourceProviderId || "—" });
				}
				if (binding.sourceType === "custom") return t("settings.providerQuota.custom");
				const templateId = binding.sourceType === "template" ? binding.templateId : (provider.templateId || binding.templateId);
				const template = quotaTemplates.find((item) => item.id === templateId);
				return binding.sourceType === "auto"
					? t("settings.providerQuota.autoSummary", { template: template?.name || templateId || "—" })
					: (template?.name || templateId || "—");
			};
			const testProviderBinding = async (provider, binding) => {
				setSourceTest({ state: "testing", fields: [], message: "", diagnostics: null, providerId: provider.id });
				try {
					const clean = cloneSettings(binding);
					delete clean.adapterId;
					delete clean.implicit;
					delete clean.migrated;
					delete clean._edited;
					const res = await fetch("/query-credits/test-connection", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ binding: clean })
					});
					const data = await res.json();
					if (!data.ok) {
						const message = data.error || "connection failed";
						setSourceTest({ state: "error", fields: [], message, diagnostics: data.diagnostics ?? null, providerId: provider.id });
						showToast(t("settings.providerQuota.testFailedToast", { error: message }), "error", 5000);
						return;
					}
					const fields = Array.isArray(data.availableFields) ? data.availableFields : [];
					const details = [
						...Object.entries(data.usage ?? {}).map(([key, window]) => opencodeWindowName(key, t) + " " + formatPercent(window?.percent)),
						...(data.metrics ?? []).map((metric) => (metric?.label || metric?.key || "Quota") + " " + formatMetricValue(metric)),
						...(data.balances ?? []).map((wallet) => (wallet?.currency || "") + " " + String(wallet?.total ?? 0)),
					].filter(Boolean);
					setSourceTest({
						state: "ok",
						fields,
						diagnostics: null,
						providerId: provider.id,
						message: details.length
							? t("settings.providerQuota.testParsed", { count: details.length, details: details.join(" · ") })
							: t("settings.providerQuota.testFields", { count: fields.length }),
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					setSourceTest({ state: "error", fields: [], message, diagnostics: null, providerId: provider.id });
					showToast(t("settings.providerQuota.testFailedToast", { error: message }), "error", 5000);
				}
			};

			const emptyCustomSourceDraft = () => ({
				id: "",
				name: "",
				kind: "metric",
				template: "",
				providerIds: "",
				providerPatterns: [],
				enabled: true,
				request: { method: "GET", url: "", dshProvider: "", credentialMode: "direct", authRef: "", authValue: "", credentialConfigured: false, authStyle: "bearer", authHeader: "Authorization", authParam: "api_key", headers: {}, bodyType: "none", body: "" },
				response: {
					metrics: [{ key: "remaining", label: "剩余额度", valuePath: "", usedPath: "", totalPath: "", unit: "", resetsAtPath: "", aggregate: "value", scale: 1, offset: 0 }],
				},
			});
			const sourceToDraft = (source) => ({
				...cloneSettings(source),
				providerIds: (source.providerIds ?? []).join(", "),
				providerPatterns: source.providerPatterns ?? [],
			});
			const draftToSource = (draft) => ({
				...cloneSettings(draft),
				id: String(draft.id ?? "").trim().toLowerCase(),
				name: String(draft.name ?? draft.id).trim() || String(draft.id ?? "").trim(),
				providerIds: String(draft.providerIds ?? "").split(",").map((s) => s.trim()).filter(Boolean),
				providerPatterns: Array.isArray(draft.providerPatterns) ? draft.providerPatterns : [],
				request: { ...(draft.request ?? {}), authStyle: draft.request?.authStyle || "bearer" },
				response: { ...(draft.response ?? {}) },
			});
			const patchCustomDraft = (field, value) => {
				setCustomSourceDraft((prev) => ({ ...(prev ?? emptyCustomSourceDraft()), [field]: value }));
				setSourceTest({ state: "idle", fields: [], message: "" });
			};
			const patchCustomNested = (section, field, value) => {
				setCustomSourceDraft((prev) => {
					const base = prev ?? emptyCustomSourceDraft();
					return { ...base, [section]: { ...(base[section] ?? {}), [field]: value } };
				});
				if (section === "request") setSourceTest({ state: "idle", fields: [], message: "" });
			};
			const beginAddSource = () => {
				setEditingSourceId(null);
				setCustomSourceError("");
				setSourceTest({ state: "idle", fields: [], message: "" });
				setCustomSourceDraft(emptyCustomSourceDraft());
			};
			const beginAddTemplate = (template, dshProvider = null) => {
				if (!template?.source) return;
				const source = cloneSettings(template.source);
				if (dshProvider) {
					const routeId = String(dshProvider.id).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
					source.id = routeId || source.id;
					source.name = dshProvider.name + (template.category === "subscription" ? " 套餐" : " 余额");
					source.providerIds = [...new Set([dshProvider.id, ...(source.providerIds ?? [])])];
					source.request = { ...(source.request ?? {}), dshProvider: dshProvider.id };
				}
				setEditingSourceId(null);
				setCustomSourceError("");
				setSourceTest({ state: "idle", fields: [], message: "" });
				setCustomSourceDraft(sourceToDraft(source));
			};
			const beginEditSource = (source) => {
				setEditingSourceId(source.id);
				setCustomSourceError("");
				setSourceTest({ state: "idle", fields: [], message: "" });
				setCustomSourceDraft(sourceToDraft(source));
			};
			const persistQuotaSources = async (updated, nextProvider = null) => {
				if (savingCard) return false;
				setSavingCard("quota");
				setFailedCard(null);
				try {
					const payload = { quotaSources: updated.map((source) => cloneSettings(source)) };
					if (nextProvider) payload.provider = nextProvider;
					const res = await fetch("/query-credits/config", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(payload)
					});
					const data = await res.json();
					if (!data.ok || !data.config) throw new Error(data.error || "save failed");
					const nextBase = configToForm(data.config);
					const quotaDraft = { ...(drafts.quota ?? {}) };
					delete quotaDraft.quotaSources;
					if (nextProvider) delete quotaDraft.provider;
					for (const [key, value] of Object.entries({ ...quotaDraft })) {
						if (valuesEqual(key, value, nextBase[key])) delete quotaDraft[key];
					}
					const nextDrafts = { ...drafts, quota: Object.keys(quotaDraft).length ? quotaDraft : null };
					settingsDraftMem.baseline = nextBase;
					settingsDraftMem.drafts = nextDrafts;
					settingsDraftMem.hydrated = true;
					persistSessionDraft();
					setBaseline(nextBase);
					setDrafts(nextDrafts);
					showToast(t("settings.sourceSaved"));
					void balanceStore.forceRefresh();
					return true;
				} catch (error) {
					setCustomSourceError(error instanceof Error ? error.message : String(error));
					setFailedCard("quota");
					return false;
				} finally {
					setSavingCard(null);
				}
			};
			const testCustomSource = async () => {
				const draft = customSourceDraft;
				if (!draft || !String(draft.id ?? "").trim()) {
					setCustomSourceError(t("settings.quotaSourceIdRequired"));
					return;
				}
				setCustomSourceError("");
				setSourceTest({ state: "testing", fields: [], message: "", diagnostics: null });
				try {
					const res = await fetch("/query-credits/test-connection", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ source: draftToSource(draft) })
					});
					const data = await res.json();
					if (!data.ok) {
						const message = data.error || "connection failed";
						setSourceTest({ state: "error", fields: [], message, diagnostics: data.diagnostics ?? null });
						showToast(t("settings.providerQuota.testFailedToast", { error: message }), "error", 5000);
						return;
					}
					const fields = Array.isArray(data.availableFields) ? data.availableFields : [];
					const parsedCount = Object.keys(data.usage ?? {}).length + (data.metrics?.length ?? 0) + (data.balances?.length ?? 0);
					const parsedDetails = [
						...Object.entries(data.usage ?? {}).map(([key, window]) =>
							opencodeWindowName(key, t) + " " + formatPercent(window?.percent)),
						...(data.metrics ?? []).map((metric) => {
							const value = formatMetricValue(metric);
							const total = Number(metric?.total);
							const totalText = Number.isFinite(total) && total > 0
								? " / " + String(total) + (metric?.unit ? " " + metric.unit : "")
								: "";
							return (metric?.label || metric?.key || "Quota") + " " + value + totalText;
						}),
						...(data.balances ?? []).map((balance) =>
							(balance?.currency || "") + " " + String(Number(balance?.total) || 0)),
					].filter(Boolean).join(" · ");
					setSourceTest({
						state: "ok",
						fields,
						diagnostics: null,
						message: t(draft.template ? "settings.testSuccessTemplate" : "settings.testSuccess", {
							count: draft.template ? parsedCount : fields.length,
							details: parsedDetails || "—",
						})
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					setSourceTest({ state: "error", fields: [], message, diagnostics: null });
					showToast(t("settings.providerQuota.testFailedToast", { error: message }), "error", 5000);
				}
			};
			const saveCustomSource = async () => {
				const draft = customSourceDraft;
				if (!draft || !String(draft.id ?? "").trim()) {
					setCustomSourceError(t("settings.quotaSourceIdRequired"));
					return;
				}
				const nextSource = draftToSource(draft);
				const current = Array.isArray(view.quotaSources) ? view.quotaSources : [];
				const collision = current.some((source) => source.id === nextSource.id && source.id !== editingSourceId);
				if (collision) {
					setCustomSourceError("ID already exists: " + nextSource.id);
					return;
				}
				const updated = editingSourceId
					? current.map((s) => s.id === editingSourceId ? nextSource : s)
					: [...current, nextSource];
				if (await persistQuotaSources(updated)) {
					setCustomSourceDraft(null);
					setEditingSourceId(null);
					setCustomSourceError("");
					setSourceTest({ state: "idle", fields: [], message: "" });
				}
			};
			const removeCustomSource = async (id) => {
				const current = Array.isArray(view.quotaSources) ? view.quotaSources : [];
				const updated = current.filter((s) => s.id !== id);
				const nextProvider = view.provider === id ? "deepseek" : null;
				if (await persistQuotaSources(updated, nextProvider) && editingSourceId === id) {
					setCustomSourceDraft(null);
					setEditingSourceId(null);
				}
			};

			const displayCheck = (field, labelKey, hintKey) => react.createElement(FieldRow, {
				t,
				key: field,
				label: t(labelKey),
				hint: t(hintKey),
				overridden: isSchemaOverridden(field, view[field], currency),
				onReset: () => resetField("display", field),
				disabled: !quotaEnabled || savingCard === "display",
				trailing: react.createElement(SwitchControl, {
					checked: view[field] !== false,
					disabled: !quotaEnabled || savingCard === "display",
					onChange: (e) => patchCard("display", { [field]: e.target.checked }),
					label: t(labelKey),
					key: "switch"
				})
			});

			const displayCard = react.createElement(PluginCard, {
				t,
				title: t("settings.card.display"),
				description: t("settings.card.displayDesc"),
				dirty: dirtyOf("display"),
				open: open.display === true,
				onToggle: () => toggleOpen("display"),
				saving: savingCard === "display",
				failed: failedCard === "display",
				onDiscard: () => discardCard("display"),
				onSave: () => { void saveCard("display"); },
				key: "display"
			}, [
				react.createElement("div", { className: "dshqb_toggle_list", key: "display_toggles" }, [
					displayCheck("showDock", "settings.showDock", "settings.showDockHint"),
					displayCheck("showCapsule", "settings.showCapsule", "settings.showCapsuleHint"),
					displayCheck("showPopover", "settings.showPopover", "settings.showPopoverHint"),
					displayCheck("showTps", "settings.showTps", "settings.showTpsHint")
				]),
				react.createElement(FieldGrid, { key: "display_bar" }, [
					react.createElement(FieldRow, {
						t,
						key: "dockLayout",
						label: t("settings.dockLayout"),
						hint: t("settings.dockLayoutHint"),
						overridden: isSchemaOverridden("dockLayout", view.dockLayout, currency),
						onReset: () => resetField("display", "dockLayout"),
						disabled: savingCard === "display" || view.showDock === false
					}, react.createElement("div", {
						className: "dshqb_layout_choices",
						role: "radiogroup",
						"aria-label": t("settings.dockLayout")
					}, ["own", "shared"].map((layout) => {
						const selected = normalizeDockLayout(view.dockLayout) === layout;
						return react.createElement("button", {
							type: "button",
							className: "dshqb_layout_choice" + (selected ? " dshqb_layout_choice_selected" : ""),
							role: "radio",
							"aria-checked": selected,
							disabled: !quotaEnabled || view.showDock === false || savingCard === "display",
							onClick: () => patchCard("display", { dockLayout: layout }),
							key: layout
						}, [
							react.createElement("span", { className: "dshqb_layout_choice_mark", "aria-hidden": "true", key: "mark" }),
							react.createElement("span", { className: "dshqb_layout_choice_label", key: "label" }, t("settings.dockLayout." + layout))
						]);
					})))
				])
			]);

			const quotaCard = react.createElement(PluginCard, {
				t,
				title: t("settings.card.quota"),
				description: t("settings.card.quotaDesc"),
				dirty: dirtyOf("quota"),
				open: open.quota === true,
				onToggle: () => toggleOpen("quota"),
				saving: savingCard === "quota",
				failed: failedCard === "quota",
				onDiscard: () => { discardCard("quota"); setEditingProviderId(null); setSourceTest({ state: "idle", fields: [], message: "" }); },
				onSave: () => { void saveCard("quota"); },
				hideFooter: editingProviderId !== null,
				key: "quota"
			}, [
				react.createElement("div", { className: "dshqb_provider_quota_intro", key: "intro" }, t("settings.providerQuota.intro")),
				visibleDshProviders.length === 0
					? react.createElement("div", { className: "dshqb_provider_quota_empty", key: "empty" }, t("settings.providerQuota.empty"))
					: react.createElement("div", { className: "dshqb_provider_quota_list", key: "providers" }, visibleDshProviders.map((provider) => {
						const binding = cloneSettings(providerBindingFor(provider.id) ?? defaultProviderBinding(provider));
						const enabled = binding.enabled !== false;
						const editing = editingProviderId === provider.id;
						const source = binding.source ?? emptyProviderCustomSource(provider);
						const metrics = Array.isArray(source.response?.metrics) && source.response.metrics.length
							? source.response.metrics
							: [{ key: "remaining", label: "剩余额度", valuePath: "", usedPath: "", totalPath: "", unit: "", resetsAtPath: "", aggregate: "value", scale: 1, offset: 0 }];
						const testState = sourceTest.providerId === provider.id ? sourceTest : { state: "idle", fields: [], message: "" };
						const otherProviders = visibleDshProviders.filter((item) => item.id !== provider.id);
						const sourceTypes = [
							...(provider.quotaSupported === true ? [["auto", t("settings.providerQuota.auto")]] : []),
							["template", t("settings.providerQuota.template")],
							...(otherProviders.length ? [["provider", t("settings.providerQuota.reuse")]] : []),
							["custom", t("settings.providerQuota.custom")],
						];
						const currentSourceType = sourceTypes.some(([value]) => value === binding.sourceType) ? binding.sourceType : sourceTypes[0][0];
						const hintKey = "settings.providerQuota." + (currentSourceType === "provider" ? "reuseHint" : currentSourceType + "Hint");
						const providerFieldOptions = (current) => {
							const rows = Array.isArray(testState.fields) ? testState.fields : [];
							const options = [["", rows.length ? t("settings.selectField") : t("settings.testFirst")]];
							if (current && !rows.some((field) => field.path === current)) options.push([current, current]);
							for (const field of rows) options.push([field.path, field.path + " — " + String(field.value)]);
							return options;
						};
						const patchSource = (section, value, preserveTestFields = false) => updateProviderBinding(provider, (current) => {
							const currentSource = current.source ?? emptyProviderCustomSource(provider);
							return { source: { ...currentSource, [section]: { ...(currentSource[section] ?? {}), ...value } } };
						}, preserveTestFields);
						const patchMetric = (index, field, value) => patchSource("response", {
							metrics: metrics.map((metric, metricIndex) => metricIndex === index ? { ...metric, [field]: value } : metric)
						}, true);
						const patchHeaders = (headers) => patchSource("request", { headers });
						const requestDshProvider = source.request?.dshProvider;
						const selectedTemplateId = currentSourceType === "auto"
							? (provider.templateId || binding.templateId)
							: binding.templateId;
						const selectedTemplate = quotaTemplates.find((item) => item.id === selectedTemplateId);
						const credentialChoice = source.request?.credentialMode === "direct" ? "__value" : source.request?.credentialMode === "none" ? "__none" : requestDshProvider
							? requestDshProvider
							: ((source.request?.authValue || source.request?.credentialConfigured) ? "__value" : (source.request?.authStyle === "none" ? "__none" : "__ref"));
						const authStyle = source.request?.authStyle || "bearer";
						const hasCredential = credentialChoice !== "__none";
						const authNeedsHeader = ["bearer", "token", "basic", "header"].includes(authStyle);
						const authNeedsParam = ["query", "json", "form"].includes(authStyle);
						const requestHeaders = Object.entries(source.request?.headers ?? {});
						let nextMetricIndex = metrics.length + 1;
						while (metrics.some((metric) => metric.key === "metric-" + nextMetricIndex)) nextMetricIndex += 1;
						const nextMetricKey = "metric-" + nextMetricIndex;
						const replaceHeader = (index, nextName, nextValue) => {
							const entries = requestHeaders.map(([name, value], rowIndex) => rowIndex === index ? [nextName, nextValue] : [name, value]);
							patchHeaders(Object.fromEntries(entries.filter(([name]) => String(name).trim())));
						};
						const diagnosticResponse = testState.diagnostics?.response;
						const diagnosticBody = diagnosticResponse?.body
							? (typeof diagnosticResponse.body === "string" ? diagnosticResponse.body : JSON.stringify(diagnosticResponse.body, null, 2))
							: t("settings.providerQuota.diagnosticNoBody");
						const diagnosticPreview = diagnosticResponse
							? t("settings.providerQuota.diagnosticStatus", { status: diagnosticResponse.status ?? "—", statusText: diagnosticResponse.statusText || "" }).trim() + "\n" + diagnosticBody
							: "";
						const testResult = testState.state === "ok" || testState.state === "error"
							? react.createElement("div", {
								className: "dshqb_source_test " + (testState.state === "ok" ? "dshqb_source_test_ok" : "dshqb_source_test_bad"),
								role: "status",
								key: "test_result"
							}, [
								react.createElement("div", { className: "dshqb_source_test_head", key: "head" }, [
									react.createElement("span", { className: "dshqb_source_test_message", key: "message" }, testState.message),
									testState.diagnostics ? react.createElement("button", {
										type: "button",
										className: "dshqb_diagnostic_copy",
										onClick: () => { void copyTestDiagnostics(testState.message, testState.diagnostics); },
										key: "copy"
									}, t("settings.providerQuota.copyDiagnostics")) : null,
								]),
								diagnosticPreview ? react.createElement("pre", { className: "dshqb_diagnostic_preview", key: "preview" }, diagnosticPreview) : null,
							])
							: null;
						const editor = editing ? react.createElement("div", { className: "dshqb_provider_quota_editor", key: "editor" }, [
							react.createElement(FieldGrid, { key: "source_type_grid" }, [
								react.createElement(FieldRow, {
									t, key: "source_type", wide: true, label: t("settings.providerQuota.source"), hint: t(hintKey), disabled: savingCard === "quota"
								}, react.createElement("select", {
									className: "dshqb_select",
									value: currentSourceType,
									onChange: (e) => {
										const sourceType = e.target.value;
										updateProviderBinding(provider, (current) => ({
											enabled: true,
											sourceType,
											templateId: sourceType === "auto" ? (provider.templateId || "") : (current.templateId || quotaTemplates[0]?.id || ""),
											sourceProviderId: sourceType === "provider" ? (current.sourceProviderId || otherProviders[0]?.id || "") : current.sourceProviderId,
											...(sourceType === "custom" ? { source: current.source ?? emptyProviderCustomSource(provider) } : {}),
										}));
									}
								}, sourceTypes.map(([value, label]) => react.createElement("option", { value, key: value }, label))))
							]),
							currentSourceType === "template" ? react.createElement(FieldGrid, { key: "template_grid" }, [
								react.createElement(FieldRow, { t, key: "template", wide: true, label: t("settings.providerQuota.templateSelect"), hint: selectedTemplate?.description || "", disabled: savingCard === "quota" },
									react.createElement("select", {
										className: "dshqb_select", value: binding.templateId || quotaTemplates[0]?.id || "",
										onChange: (e) => updateProviderBinding(provider, { templateId: e.target.value, sourceType: "template", enabled: true })
										}, ["subscription", "balance"].flatMap((category) => quotaTemplates.filter((item) => item.category === category).map((template) =>
											react.createElement("option", { value: template.id, key: template.id }, t("settings.template." + category) + " · " + template.name)
									)))
								)
							]) : null,
							currentSourceType === "provider" ? react.createElement(FieldGrid, { key: "reuse_grid" }, [
								react.createElement(FieldRow, { t, key: "reuse", wide: true, label: t("settings.providerQuota.reuseSelect"), disabled: savingCard === "quota" },
									react.createElement("select", {
										className: "dshqb_select", value: binding.sourceProviderId || otherProviders[0]?.id || "",
										onChange: (e) => updateProviderBinding(provider, { sourceProviderId: e.target.value, sourceType: "provider", enabled: true })
									}, otherProviders.map((item) => react.createElement("option", { value: item.id, key: item.id }, item.name + " · " + item.id)))
								)
							]) : null,
							currentSourceType === "custom" ? react.createElement("div", { className: "dshqb_provider_custom", key: "custom" }, [
								react.createElement(FieldGrid, { key: "request_grid" }, [
									react.createElement(FieldRow, { t, key: "url", wide: true, label: t("settings.providerQuota.endpoint"), disabled: savingCard === "quota" },
										react.createElement("input", { className: "dshqb_input", type: "text", value: source.request?.url || "", placeholder: "https://api.example.com/v1/credits", onChange: (e) => patchSource("request", { url: e.target.value }) })
									),
									react.createElement(FieldRow, { t, key: "method", label: t("settings.requestMethod"), disabled: savingCard === "quota" },
										react.createElement("select", { className: "dshqb_select", value: source.request?.method || "GET", onChange: (e) => patchSource("request", { method: e.target.value }) },
											["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => react.createElement("option", { value: method, key: method }, method)))
									),
									react.createElement(FieldRow, { t, key: "credential", wide: true, label: t("settings.providerQuota.credential"), disabled: savingCard === "quota" },
										react.createElement("select", {
											className: "dshqb_select", value: credentialChoice,
										onChange: (e) => {
											const choice = e.target.value;
											const nextStyle = source.request?.authStyle === "none" ? "bearer" : (source.request?.authStyle || "bearer");
											if (choice === "__none") patchSource("request", { credentialMode: "none", dshProvider: "", authRef: "", authValue: "", credentialConfigured: false, authStyle: "none" });
											else if (choice === "__ref") patchSource("request", { credentialMode: "reference", dshProvider: "", authValue: "", authStyle: nextStyle });
											else if (choice === "__value") patchSource("request", { credentialMode: "direct", dshProvider: "", authRef: source.request?.credentialMode === "direct" ? (source.request?.authRef || "") : "", authValue: "", credentialConfigured: source.request?.credentialMode === "direct" && source.request?.credentialConfigured === true, authStyle: nextStyle });
											else patchSource("request", { credentialMode: "provider", dshProvider: choice, authRef: "", authValue: "", authStyle: nextStyle });
										}
									}, [
										react.createElement("option", { value: "__value", key: "__value" }, t("settings.providerQuota.credentialDirect")),
										react.createElement("option", { value: provider.id, key: provider.id }, t("settings.providerQuota.credentialCurrent", { name: provider.name })),
										...dshProviderDirectory.filter((item) => item.id !== provider.id && item.configured === true).map((item) => react.createElement("option", { value: item.id, key: item.id }, t("settings.providerQuota.credentialOther", { name: item.name }))),
											react.createElement("option", { value: "__ref", key: "__ref" }, t("settings.providerQuota.credentialRef")),
											react.createElement("option", { value: "__none", key: "__none" }, t("settings.providerQuota.credentialNone")),
										])
									),
									credentialChoice === "__value" ? react.createElement(FieldRow, { t, key: "auth_value", label: t("settings.directCredential"), hint: t(authStyle === "cookie" ? "settings.cookieCredentialHint" : "settings.directCredentialHint"), disabled: savingCard === "quota" },
										react.createElement("div", { className: "dshqb_secret_input" }, [
											react.createElement("input", { className: "dshqb_input", key: "input", type: "password", autoComplete: "new-password", value: source.request?.authValue || "", placeholder: source.request?.credentialConfigured ? t("settings.directCredentialPlaceholder") : (authStyle === "cookie" ? t("settings.cookieCredentialPlaceholder") : ""), onChange: (e) => patchSource("request", { authValue: e.target.value }) }),
											source.request?.credentialConfigured ? react.createElement("span", { className: "dshqb_secret_status", key: "status" }, t("settings.directCredentialConfigured")) : null
										])
									) : null,
									credentialChoice === "__ref" ? react.createElement(FieldRow, { t, key: "auth_ref", label: t("settings.quotaAuthRef"), hint: t("settings.quotaAuthRefHint"), disabled: savingCard === "quota" },
										react.createElement("input", { className: "dshqb_input", type: "text", value: source.request?.authRef || "", onChange: (e) => patchSource("request", { authRef: e.target.value }) })
									) : null,
									hasCredential ? react.createElement(FieldRow, { t, key: "auth_style", label: t("settings.authStyle"), disabled: savingCard === "quota" },
										react.createElement("select", { className: "dshqb_select", value: authStyle, onChange: (e) => {
											const nextStyle = e.target.value;
											patchSource("request", { authStyle: nextStyle, ...(nextStyle === "json" || nextStyle === "form" ? { bodyType: nextStyle, method: ["GET", "HEAD"].includes(source.request?.method || "GET") ? "POST" : source.request.method } : {}) });
										} }, [
											react.createElement("option", { value: "bearer", key: "bearer" }, t("settings.auth.bearer")),
											react.createElement("option", { value: "token", key: "token" }, t("settings.auth.token")),
											react.createElement("option", { value: "basic", key: "basic" }, t("settings.auth.basic")),
											react.createElement("option", { value: "header", key: "header" }, t("settings.auth.header")),
											react.createElement("option", { value: "cookie", key: "cookie" }, t("settings.auth.cookie")),
											react.createElement("option", { value: "query", key: "query" }, t("settings.auth.query")),
											react.createElement("option", { value: "json", key: "json" }, t("settings.auth.json")),
											react.createElement("option", { value: "form", key: "form" }, t("settings.auth.form")),
										])
									) : null,
									hasCredential && authNeedsHeader ? react.createElement(FieldRow, { t, key: "auth_header", label: t("settings.authHeader"), disabled: savingCard === "quota" },
										react.createElement("input", { className: "dshqb_input", value: source.request?.authHeader || "Authorization", onChange: (e) => patchSource("request", { authHeader: e.target.value }) })
									) : null,
									hasCredential && authNeedsParam ? react.createElement(FieldRow, { t, key: "auth_param", label: t("settings.authParam"), disabled: savingCard === "quota" },
										react.createElement("input", { className: "dshqb_input", value: source.request?.authParam || "api_key", onChange: (e) => patchSource("request", { authParam: e.target.value }) })
									) : null,
								]),
								react.createElement("div", { className: "dshqb_provider_mapping", key: "headers" }, [
									react.createElement("span", { className: "dshqb_template_group_title", key: "title" }, t("settings.requestHeaders")),
									react.createElement("span", { className: "dshqb_hint", key: "hint" }, t("settings.requestHeadersHint")),
									react.createElement("div", { className: "dshqb_header_list", key: "list" }, requestHeaders.map(([name, value], index) =>
										react.createElement("div", { className: "dshqb_header_row", key: name + index }, [
											react.createElement("input", { className: "dshqb_input", value: name, placeholder: t("settings.headerName"), onChange: (e) => replaceHeader(index, e.target.value, value), key: "name" }),
											react.createElement("input", { className: "dshqb_input", value: value === "***" ? "" : value, placeholder: value === "***" ? "••••••••" : t("settings.headerValue"), onChange: (e) => replaceHeader(index, name, e.target.value), key: "value" }),
											react.createElement("button", { type: "button", className: "dshqb_btn dshqb_btn_outline", onClick: () => patchHeaders(Object.fromEntries(requestHeaders.filter((_, rowIndex) => rowIndex !== index))), key: "remove" }, "×")
										])
									)),
									react.createElement("div", { className: "dshqb_source_actions", key: "add" }, react.createElement("button", { type: "button", className: "dshqb_btn dshqb_btn_outline", onClick: () => patchHeaders({ ...(source.request?.headers ?? {}), ["X-Header-" + (requestHeaders.length + 1)]: "" }) }, t("settings.addHeader")))
								]),
								react.createElement(FieldGrid, { key: "body_grid" }, [
									react.createElement(FieldRow, { t, key: "body_type", label: t("settings.bodyType"), disabled: savingCard === "quota" },
										react.createElement("select", { className: "dshqb_select", value: source.request?.bodyType || "none", onChange: (e) => patchSource("request", { bodyType: e.target.value }) }, [
											react.createElement("option", { value: "none", key: "none" }, t("settings.body.none")),
											react.createElement("option", { value: "json", key: "json" }, t("settings.body.json")),
											react.createElement("option", { value: "form", key: "form" }, t("settings.body.form")),
											react.createElement("option", { value: "raw", key: "raw" }, t("settings.body.raw")),
										])
									),
									(source.request?.bodyType || "none") !== "none" ? react.createElement(FieldRow, { t, key: "body", wide: true, label: t("settings.body"), hint: t("settings.bodyHint"), disabled: savingCard === "quota" },
										react.createElement("textarea", { className: "dshqb_input dshqb_textarea", value: source.request?.body || "", placeholder: source.request?.bodyType === "json" ? "{\n  \"pageSize\": 100\n}" : "key=value", onChange: (e) => patchSource("request", { body: e.target.value }) })
									) : null,
								]),
								react.createElement("div", { className: "dshqb_source_actions", key: "test_actions" },
									react.createElement("button", { type: "button", className: "dshqb_btn dshqb_btn_outline", disabled: testState.state === "testing" || savingCard === "quota", onClick: () => { void testProviderBinding(provider, { ...binding, sourceType: "custom", source }); } }, t(testState.state === "testing" ? "settings.btnTesting" : "settings.btnTest"))
								),
								testResult,
								react.createElement("div", { className: "dshqb_provider_mapping", key: "mapping" }, [
									react.createElement("span", { className: "dshqb_template_group_title", key: "title" }, t("settings.providerQuota.mapping")),
									react.createElement("div", { className: "dshqb_form_hint", key: "hint" }, t("settings.metricMappingHint")),
									react.createElement("div", { className: "dshqb_metric_list", key: "metric_list" }, metrics.map((metric, metricIndex) => {
										const listId = "dshqb-fields-" + provider.id.replace(/[^a-z0-9_-]/gi, "-") + "-" + metricIndex;
										const fieldInput = (field, label, hint) => {
											const fieldListId = listId + "-" + field;
											return react.createElement(FieldRow, { t, key: field, label: t(label), hint: t(hint), disabled: savingCard === "quota" }, [
												react.createElement("input", { className: "dshqb_input", list: fieldListId, value: metric[field] || "", placeholder: "$.data.value", onChange: (e) => patchMetric(metricIndex, field, e.target.value), key: "input" }),
												react.createElement("datalist", { id: fieldListId, key: "list" }, providerFieldOptions(metric[field]).filter(([value]) => value).map(([value, text]) => react.createElement("option", { value, label: text, key: value })))
											]);
										};
										return react.createElement("div", { className: "dshqb_metric_editor", key: metric.key || metricIndex }, [
											react.createElement("div", { className: "dshqb_metric_editor_head", key: "head" }, [
												react.createElement("span", { key: "label" }, t("settings.metricItem", { index: metricIndex + 1 })),
												metrics.length > 1 ? react.createElement("button", { type: "button", className: "dshqb_btn dshqb_btn_outline", onClick: () => patchSource("response", { metrics: metrics.filter((_, index) => index !== metricIndex) }, true), key: "remove" }, t("settings.removeMetric")) : null,
											]),
											react.createElement(FieldGrid, { key: "grid" }, [
												react.createElement(FieldRow, { t, key: "label", label: t("settings.metricLabel"), disabled: savingCard === "quota" }, react.createElement("input", { className: "dshqb_input", value: metric.label || "", onChange: (e) => patchMetric(metricIndex, "label", e.target.value) })),
												react.createElement(FieldRow, { t, key: "unit", label: t("settings.metricUnit"), hint: t("settings.metricUnitHint"), disabled: savingCard === "quota" }, react.createElement("input", { className: "dshqb_input", value: metric.unit || "", placeholder: "CNY / USD / 次", onChange: (e) => patchMetric(metricIndex, "unit", e.target.value) })),
												fieldInput("valuePath", "settings.metricValuePath", "settings.metricValuePathHint"),
												fieldInput("usedPath", "settings.metricUsedPath", "settings.metricUsedPathHint"),
												fieldInput("totalPath", "settings.metricTotalPath", "settings.metricTotalPathHint"),
												fieldInput("resetsAtPath", "settings.metricResetPath", "settings.metricResetPathHint"),
												react.createElement(FieldRow, { t, key: "aggregate", label: t("settings.metricAggregate"), hint: t("settings.metricAggregateHint"), disabled: savingCard === "quota" }, react.createElement("select", { className: "dshqb_select", value: metric.aggregate || "value", onChange: (e) => patchMetric(metricIndex, "aggregate", e.target.value) }, ["value", "sum", "count", "min", "max"].map((value) => react.createElement("option", { value, key: value }, t("settings.metricAggregate." + value))))),
												react.createElement(FieldRow, { t, key: "scale", label: t("settings.metricScale"), hint: t("settings.metricScaleHint"), disabled: savingCard === "quota" }, react.createElement("input", { className: "dshqb_input", type: "number", step: "any", value: metric.scale ?? 1, onChange: (e) => patchMetric(metricIndex, "scale", Number(e.target.value)) })),
												react.createElement(FieldRow, { t, key: "offset", label: t("settings.metricOffset"), hint: t("settings.metricOffsetHint"), disabled: savingCard === "quota" }, react.createElement("input", { className: "dshqb_input", type: "number", step: "any", value: metric.offset ?? 0, onChange: (e) => patchMetric(metricIndex, "offset", Number(e.target.value)) })),
											])
										]);
									})),
									react.createElement("div", { className: "dshqb_source_actions", key: "add_metric" }, react.createElement("button", { type: "button", className: "dshqb_btn dshqb_btn_outline", onClick: () => patchSource("response", { metrics: [...metrics, { key: nextMetricKey, label: "额度 " + nextMetricIndex, valuePath: "", usedPath: "", totalPath: "", resetsAtPath: "", unit: "", aggregate: "value", scale: 1, offset: 0 }] }, true) }, t("settings.addMetric")))
								])
							]) : react.createElement("div", { className: "dshqb_provider_template_test", key: "template_test" }, [
								selectedTemplate?.autoEnable === false && selectedTemplate.description
									? react.createElement("div", { className: "dshqb_source_test dshqb_source_test_warn", key: "template_notice" }, selectedTemplate.description)
									: null,
								react.createElement("div", { className: "dshqb_source_actions", key: "actions" }, react.createElement("button", {
									type: "button", className: "dshqb_btn dshqb_btn_outline", disabled: currentSourceType === "provider" || testState.state === "testing" || savingCard === "quota",
									onClick: () => { void testProviderBinding(provider, {
										...binding,
										sourceType: currentSourceType,
										templateId: binding.templateId || provider.templateId || quotaTemplates[0]?.id || "",
									}); }
								}, t(testState.state === "testing" ? "settings.btnTesting" : "settings.btnTest"))),
								testResult
							]),
							react.createElement("div", { className: "dshqb_provider_editor_footer", key: "save_actions" }, [
								react.createElement("span", {
									className: "dshqb_provider_editor_save_hint" + (failedCard === "quota" ? " dshqb_provider_editor_save_hint_error" : ""),
									role: failedCard === "quota" ? "status" : undefined,
									key: "hint"
								}, failedCard === "quota" ? t("settings.saveFailed") : t("settings.providerQuota.saveHint")),
								react.createElement("button", {
									type: "button",
									className: "dshqb_btn dshqb_btn_outline",
									disabled: !dirtyOf("quota") || savingCard === "quota",
									onClick: () => { discardCard("quota"); setEditingProviderId(null); setSourceTest({ state: "idle", fields: [], message: "" }); },
									key: "discard"
								}, t("settings.btnDiscard")),
								react.createElement("button", {
									type: "button",
									className: "dshqb_btn dshqb_btn_primary",
									disabled: !dirtyOf("quota") || savingCard === "quota",
									onClick: () => { void saveCard("quota"); },
									key: "save"
								}, t(savingCard === "quota" ? "settings.saving" : "settings.btnSave"))
							])
						]) : null;
						return react.createElement("div", { className: "dshqb_provider_quota_item" + (enabled ? "" : " dshqb_provider_quota_item_off"), key: provider.id }, [
							react.createElement("div", { className: "dshqb_provider_quota_head", key: "head" }, [
								react.createElement("span", { className: "dshqb_provider_quota_identity", key: "identity" }, [
									react.createElement("span", { className: "dshqb_provider_quota_name", key: "name" }, provider.name || provider.id),
									react.createElement("span", { className: "dshqb_provider_quota_id", key: "id" }, provider.id),
								]),
								react.createElement("span", { className: "dshqb_provider_quota_badges", key: "badges" }, [
									provider.configured === true ? react.createElement("span", { className: "dshqb_source_chip", key: "configured" }, t("settings.providerQuota.configured")) : null,
								react.createElement(SwitchControl, {
									checked: enabled,
									disabled: savingCard === "quota",
									label: t("settings.providerQuota.enabled"),
									onChange: (e) => updateProviderBinding(provider, {
										enabled: e.target.checked,
										...(e.target.checked && provider.quotaSupported !== true && binding.sourceType === "auto"
											? { sourceType: "template", templateId: quotaTemplates[0]?.id || "" }
											: {}),
									}),
									key: "switch"
								})
								])
							]),
							react.createElement("div", { className: "dshqb_provider_quota_summary", key: "summary" }, [
								react.createElement("span", { className: "dshqb_provider_quota_source", key: "source" }, providerSourceLabel(provider, binding)),
								react.createElement("button", { type: "button", className: "dshqb_btn dshqb_btn_outline dshqb_btn_small", disabled: savingCard === "quota", onClick: () => setEditingProviderId(editing ? null : provider.id), key: "edit" }, t(editing ? "settings.collapse" : "settings.edit"))
							]),
							editor
						]);
					}))
			]);

			const threshCard = react.createElement(PluginCard, {
				t,
				title: t("settings.card.thresholds"),
				description: t("settings.card.thresholdsDesc"),
				dirty: dirtyOf("thresholds"),
				open: open.thresholds === true,
				onToggle: () => toggleOpen("thresholds"),
				saving: savingCard === "thresholds",
				failed: failedCard === "thresholds",
				onDiscard: () => discardCard("thresholds"),
				onSave: () => { void saveCard("thresholds"); },
				key: "thresholds"
			}, [
				react.createElement(InteractiveThresholdSlider, {
					danger: view.dangerThreshold,
					warning: view.warningThreshold,
					currency: view.currency,
					percentMode,
					onChange: (nextDanger, nextWarning) => patchCard("thresholds", {
						dangerThreshold: nextDanger,
						warningThreshold: nextWarning
					}),
					t,
					key: "slider"
				}),
				react.createElement(FieldGrid, { key: "thresh_pair" }, [
					react.createElement(FieldRow, {
						t,
						key: "danger",
						label: t(percentMode ? "settings.dangerPercent" : "settings.danger"),
						hint: t(percentMode ? "settings.dangerHintQuota" : "settings.dangerHint"),
						overridden: isSchemaOverridden("dangerThreshold", view.dangerThreshold, currency),
						onReset: () => resetField("thresholds", "dangerThreshold"),
						disabled: savingCard === "thresholds"
					}, react.createElement("input", {
						type: "number",
						className: "dshqb_input",
						value: view.dangerThreshold,
						onChange: (e) => patchCard("thresholds", { dangerThreshold: Number(e.target.value) })
					})),
					react.createElement(FieldRow, {
						t,
						key: "warning",
						label: t(percentMode ? "settings.warningPercent" : "settings.warning"),
						hint: t(percentMode ? "settings.warningHintQuota" : "settings.warningHint"),
						overridden: isSchemaOverridden("warningThreshold", view.warningThreshold, currency),
						onReset: () => resetField("thresholds", "warningThreshold"),
						disabled: savingCard === "thresholds"
					}, react.createElement("input", {
						type: "number",
						className: "dshqb_input",
						value: view.warningThreshold,
						onChange: (e) => patchCard("thresholds", { warningThreshold: Number(e.target.value) })
					}))
				]),
				react.createElement(FieldGrid, { key: "interval_pair" }, [
					react.createElement(FieldRow, {
						t,
						key: "server_int",
						label: t("settings.serverInterval"),
						hint: t(percentMode ? "settings.serverIntervalHintQuota" : "settings.serverIntervalHint"),
						overridden: isSchemaOverridden("refreshIntervalMs", view.refreshIntervalMs, currency),
						onReset: () => resetField("thresholds", "refreshIntervalMs"),
						disabled: savingCard === "thresholds"
					}, react.createElement("select", {
						className: "dshqb_select",
						value: view.refreshIntervalMs,
						onChange: (e) => patchCard("thresholds", { refreshIntervalMs: Number(e.target.value) })
					}, [
						react.createElement("option", { value: 60000, key: "1m" }, "1 分钟 (高频)"),
						react.createElement("option", { value: 180000, key: "3m" }, "3 分钟"),
						react.createElement("option", { value: 300000, key: "5m" }, "5 分钟 (推荐)"),
						react.createElement("option", { value: 600000, key: "10m" }, "10 分钟")
					])),
					react.createElement(FieldRow, {
						t,
						key: "client_int",
						label: t("settings.clientInterval"),
						hint: t("settings.clientIntervalHint"),
						overridden: isSchemaOverridden("clientPollIntervalMs", view.clientPollIntervalMs, currency),
						onReset: () => resetField("thresholds", "clientPollIntervalMs"),
						disabled: savingCard === "thresholds"
					}, react.createElement("select", {
						className: "dshqb_select",
						value: view.clientPollIntervalMs,
						onChange: (e) => patchCard("thresholds", { clientPollIntervalMs: Number(e.target.value) })
					}, [
						react.createElement("option", { value: 10000, key: "10s" }, "10 秒"),
						react.createElement("option", { value: 30000, key: "30s" }, "30 秒 (推荐)"),
						react.createElement("option", { value: 60000, key: "60s" }, "60 秒")
					])),
					react.createElement(FieldRow, {
						t,
						key: "timeout",
						label: t("settings.timeout"),
						hint: t("settings.timeoutHint"),
						overridden: isSchemaOverridden("timeoutMs", view.timeoutMs, currency),
						onReset: () => resetField("thresholds", "timeoutMs"),
						disabled: savingCard === "thresholds"
					}, react.createElement("input", {
						type: "number",
						className: "dshqb_input",
						value: view.timeoutMs,
						onChange: (e) => patchCard("thresholds", { timeoutMs: Number(e.target.value) })
					}))
				])
			]);

			const official = officialPricesFor(currency);
			const patchModelRates = (model, nextRates) => {
				patchCard("pricing", { prices: { ...view.prices, [model]: nextRates } });
			};
			const rateInput = (model, rates, field, step, tierKey) => {
				const slice = tierKey ? (rates[tierKey] || { cacheHit: 0, cacheMiss: 0, output: 0 }) : rates;
				return react.createElement("input", {
					type: "number",
					step,
					className: "dshqb_input dshqb_input_num",
					value: slice[field],
					onChange: (e) => {
						const n = Number(e.target.value);
						if (!tierKey) {
							patchModelRates(model, { ...rates, [field]: n });
							return;
						}
						const nextTier = { ...slice, [field]: n };
						const next = { ...rates, [tierKey]: nextTier };
						if (tierKey === "peak") {
							next.cacheHit = nextTier.cacheHit;
							next.cacheMiss = nextTier.cacheMiss;
							next.output = nextTier.output;
						}
						patchModelRates(model, next);
					}
				});
			};
			const periodTag = (kind) => react.createElement("span", {
				className: "dshqb_period_tag " + (kind === "peak" ? "dshqb_period_peak" : kind === "offPeak" ? "dshqb_period_offpeak" : "dshqb_period_flat")
			}, t(kind === "peak" ? "settings.pricingPeak" : kind === "offPeak" ? "settings.pricingOffPeak" : "settings.pricingFlat"));
			const addNewModel = () => {
				const name = newModelName.trim();
				if (!name) return;
				patchCard("pricing", {
					prices: {
						...view.prices,
						[name]: buildAddedModelPrice(newModelMultiplier, {
							cacheHit: newModelHit,
							cacheMiss: newModelMiss,
							output: newModelOut
						})
					}
				});
				setNewModelName("");
			};
			const pricingCard = react.createElement(PluginCard, {
				t,
				title: t("settings.card.pricing"),
				description: t("settings.card.pricingDesc"),
				dirty: dirtyOf("pricing"),
				open: open.pricing === true,
				onToggle: () => toggleOpen("pricing"),
				saving: savingCard === "pricing",
				failed: failedCard === "pricing",
				onDiscard: () => discardCard("pricing"),
				onSave: () => { void saveCard("pricing"); },
				key: "pricing"
			}, [
				react.createElement(FieldGrid, { key: "currency_grid" }, [
					react.createElement(FieldRow, {
						t,
						key: "currency",
						wide: true,
						label: t("settings.currency"),
						hint: t("settings.currencyHintQuota"),
						overridden: isSchemaOverridden("currency", view.currency, currency),
						onReset: () => resetField("pricing", "currency"),
						disabled: savingCard === "pricing"
					}, react.createElement("select", {
						className: "dshqb_select",
						value: view.currency,
						onChange: (e) => {
							const nextCurrency = e.target.value;
							const nextPrices = { ...(view.prices || {}) };
							for (const [model, p] of Object.entries(officialPricesFor(nextCurrency))) nextPrices[model] = p;
							patchCard("pricing", { currency: nextCurrency, prices: nextPrices, defaultPrices: officialDefaultPrices(nextCurrency) });
						}
					}, [
						react.createElement("option", { value: "CNY", key: "cny" }, "CNY (人民币 ¥)"),
						react.createElement("option", { value: "USD", key: "usd" }, "USD (美元 $)"),
						react.createElement("option", { value: "EUR", key: "eur" }, "EUR (欧元 €)")
					]))
				]),
				react.createElement("table", { className: "dshqb_pricing_table", key: "p_table" }, [
					react.createElement("thead", { key: "th" }, [
						react.createElement("tr", { key: "r" }, [
							react.createElement("th", { key: "m" }, "Model"),
							react.createElement("th", { key: "period" }, t("settings.pricingPeriod")),
							react.createElement("th", { key: "hit" }, t("settings.pricingHit") + " (" + currency + ")"),
							react.createElement("th", { key: "miss" }, t("settings.pricingMiss") + " (" + currency + ")"),
							react.createElement("th", { key: "out" }, t("settings.pricingOut") + " (" + currency + ")"),
							react.createElement("th", { style: { width: "72px" }, key: "act" }, "")
						])
					]),
					react.createElement("tbody", { key: "tb" },
						Object.entries(view.prices || {}).flatMap(([model, stored]) => {
							const rates = hydrateModelPrice(model, stored, currency);
							const officialRates = official[model];
							const overridden = !officialRates || !pricesEqualModel(rates, officialRates);
							const canDelete = !PINNED_V4_MODELS.includes(model);
							const resetBtn = overridden ? react.createElement("button", {
								type: "button",
								className: "dshqb_model_reset",
								onClick: () => {
									const next = { ...(view.prices || {}) };
									if (officialRates) next[model] = JSON.parse(JSON.stringify(officialRates));
									else delete next[model];
									patchCard("pricing", { prices: next });
								},
								key: "rst"
							}, t("settings.resetField")) : null;
							const delBtn = canDelete ? react.createElement("button", {
								type: "button",
								className: "dshqb_btn_del",
								onClick: () => {
									const next = { ...view.prices };
									delete next[model];
									patchCard("pricing", { prices: next });
								},
								title: t("settings.removeModel"),
								key: "del"
							}, "🗑️") : null;
							const enableTiersBtn = react.createElement("button", {
								type: "button",
								className: "dshqb_model_reset",
								onClick: () => patchModelRates(model, withTiers(rates, scaleRate(rates, 0.5))),
								key: "enable_tiers"
							}, t("settings.enableTiers"));
							const disableTiersBtn = canDelete ? react.createElement("button", {
								type: "button",
								className: "dshqb_model_reset",
								onClick: () => patchModelRates(model, cloneRate(rates.peak || rates)),
								key: "disable_tiers"
							}, t("settings.disableTiers")) : null;
							if (!hasTariffTiers(rates)) {
								return [react.createElement("tr", { key: model }, [
									react.createElement("td", { style: { fontWeight: "600" }, key: "m_name" }, [
										react.createElement("div", { key: "n" }, model),
										resetBtn,
										enableTiersBtn
									]),
									react.createElement("td", { key: "period" }, periodTag("flat")),
									react.createElement("td", { key: "m_hit" }, rateInput(model, rates, "cacheHit", "0.001")),
									react.createElement("td", { key: "m_miss" }, rateInput(model, rates, "cacheMiss", "0.01")),
									react.createElement("td", { key: "m_out" }, rateInput(model, rates, "output", "0.01")),
									react.createElement("td", { key: "m_del" }, delBtn)
								])];
							}
							return [
								react.createElement("tr", { key: model + "-peak" }, [
									react.createElement("td", { rowSpan: 2, style: { fontWeight: "600", verticalAlign: "top" }, key: "m_name" }, [
										react.createElement("div", { key: "n" }, model),
										resetBtn,
										disableTiersBtn
									]),
									react.createElement("td", { key: "period" }, periodTag("peak")),
									react.createElement("td", { key: "m_hit" }, rateInput(model, rates, "cacheHit", "0.001", "peak")),
									react.createElement("td", { key: "m_miss" }, rateInput(model, rates, "cacheMiss", "0.01", "peak")),
									react.createElement("td", { key: "m_out" }, rateInput(model, rates, "output", "0.01", "peak")),
									react.createElement("td", { rowSpan: 2, style: { verticalAlign: "top" }, key: "m_del" }, delBtn)
								]),
								react.createElement("tr", { key: model + "-off" }, [
									react.createElement("td", { key: "period" }, periodTag("offPeak")),
									react.createElement("td", { key: "m_hit" }, rateInput(model, rates, "cacheHit", "0.001", "offPeak")),
									react.createElement("td", { key: "m_miss" }, rateInput(model, rates, "cacheMiss", "0.01", "offPeak")),
									react.createElement("td", { key: "m_out" }, rateInput(model, rates, "output", "0.01", "offPeak"))
								])
							];
						})
					)
				]),
				react.createElement("div", { className: "dshqb_pricing_reset_bar", key: "reset_bar" },
					react.createElement("button", {
						type: "button",
						className: "dshqb_model_reset",
						onClick: () => {
							const next = { ...(view.prices || {}) };
							for (const m of PINNED_V4_MODELS) {
								const table = v4TableFor(currency)?.[m];
								if (table) next[m] = v4SettingsFromTable(table);
							}
							patchCard("pricing", { prices: next });
						}
					}, t("settings.pricingReset"))
				),
				react.createElement("div", { className: "dshqb_add_model_box", key: "add_box" }, [
					react.createElement("div", { className: "dshqb_add_model_row", key: "row" }, [
						react.createElement("input", {
							type: "text",
							className: "dshqb_input",
							style: { flex: 2, minWidth: "140px" },
							placeholder: t("settings.addModelName"),
							value: newModelName,
							onChange: (e) => setNewModelName(e.target.value),
							key: "inp_name"
						}),
						react.createElement("span", { className: "dshqb_add_model_label", key: "peak_label" }, t("settings.addFillingPeak")),
						react.createElement("input", {
							type: "number",
							step: "0.01",
							className: "dshqb_input dshqb_input_num",
							title: t("settings.pricingPeak") + " · " + t("settings.pricingHit"),
							placeholder: t("settings.pricingHit"),
							value: newModelHit,
							onChange: (e) => setNewModelHit(Number(e.target.value)),
							key: "inp_hit"
						}),
						react.createElement("input", {
							type: "number",
							step: "0.01",
							className: "dshqb_input dshqb_input_num",
							title: t("settings.pricingPeak") + " · " + t("settings.pricingMiss"),
							placeholder: t("settings.pricingMiss"),
							value: newModelMiss,
							onChange: (e) => setNewModelMiss(Number(e.target.value)),
							key: "inp_miss"
						}),
						react.createElement("input", {
							type: "number",
							step: "0.01",
							className: "dshqb_input dshqb_input_num",
							title: t("settings.pricingPeak") + " · " + t("settings.pricingOut"),
							placeholder: t("settings.pricingOut"),
							value: newModelOut,
							onChange: (e) => setNewModelOut(Number(e.target.value)),
							key: "inp_out"
						}),
						react.createElement("span", { className: "dshqb_add_model_label", key: "mult_label" }, t("settings.peakMultiplier")),
						react.createElement("input", {
							type: "number",
							min: "0",
							step: "0.1",
							className: "dshqb_input dshqb_input_mult",
							title: t("settings.peakMultiplier"),
							value: newModelMultiplier,
							onChange: (e) => setNewModelMultiplier(e.target.value === "" ? 1 : Number(e.target.value)),
							key: "mult"
						}),
						react.createElement("button", {
							type: "button",
							className: "dshqb_btn dshqb_btn_secondary",
							onClick: addNewModel,
							key: "btn_add"
						}, t("settings.btnAdd"))
					]),
					react.createElement("div", { className: "dshqb_add_model_hint", key: "hint" }, t("settings.addModelHint"))
				])
			]);

			const exportCard = react.createElement(PluginCard, {
				t,
				title: t("settings.card.export"),
				description: t("settings.card.exportDesc"),
				dirty: false,
				open: open.export === true,
				onToggle: () => toggleOpen("export"),
				saving: false,
				failed: false,
				onDiscard: () => {},
				onSave: () => {},
				hideFooter: true,
				key: "export"
			}, [
				react.createElement("div", { className: "dshqb_code_wrap", key: "code_wrap" }, [
					react.createElement("pre", { className: "dshqb_code_block", key: "code" }, generateYaml(view)),
					react.createElement(HoverTooltip, {
						content: copied ? t("settings.copied") : t("settings.btnCopy"),
						className: "dshqb_code_copy_wrap",
						key: "copy_tip"
					}, react.createElement("button", {
						type: "button",
						className: "dshqb_code_copy" + (copied ? " dshqb_code_copy_done" : ""),
						"aria-label": copied ? t("settings.copied") : t("settings.btnCopy"),
						onClick: handleCopyYaml
					}, react.createElement("span", { className: "dshqb_copy_icon", "aria-hidden": "true" })))
				])
			]);

			const enabledOverridden = isSchemaOverridden("enabled", view.enabled, currency);
			return react.createElement("div", { className: "dshqb_settings_page" }, [
				react.createElement("div", { className: "dshqb_settings_intro", key: "intro" }, [
					react.createElement("span", { className: "dshqb_settings_intro_copy", key: "copy" }, [
						react.createElement("span", { className: "dshqb_settings_intro_title", key: "title" }, t("settings.title")),
						react.createElement("span", { className: "dshqb_settings_desc", key: "desc" }, t("settings.desc"))
					]),
					react.createElement("span", {
						className: "dshqb_settings_title_control",
						title: t("settings.enabledHint"),
						key: "global"
					}, [
						react.createElement("span", { className: "dshqb_settings_title_control_label", key: "label" }, t("settings.enabled")),
						enabledOverridden ? react.createElement("span", { className: "dshqb_field_badges", key: "badges" }, [
							react.createElement("span", { className: "dshqb_field_badge", key: "ov" }, t("settings.overridden")),
							react.createElement("button", {
								type: "button",
								className: "dshqb_field_reset",
								disabled: savingEnabled,
								onClick: () => { void setGlobalEnabled(schemaDefault("enabled", currency)); },
								key: "reset"
							}, t("settings.resetField"))
						]) : null,
						react.createElement(SwitchControl, {
							checked: quotaEnabled,
							disabled: savingEnabled,
							onChange: (e) => { void setGlobalEnabled(e.target.checked); },
							label: t("settings.enabled"),
							large: true,
							key: "switch"
						})
					])
				]),
				react.createElement("div", { className: "dshqb_settings_cards", key: "cards" }, [
					react.createElement("fieldset", {
						className: "dshqb_settings_fieldset" + (quotaEnabled ? "" : " dshqb_settings_locked"),
						disabled: !quotaEnabled,
						key: "quota_settings"
					}, react.createElement("ul", { className: "dshqb_pcard_list" }, [
						displayCard,
						quotaCard,
						threshCard
					])),
					react.createElement("ul", { className: "dshqb_pcard_list", key: "always_available" }, [
						pricingCard,
						exportCard
					])
				]),
				toast ? react.createElement("div", { className: "dshqb_toast" + (toast.tone === "error" ? " dshqb_toast_error" : ""), key: "toast" }, toast.message) : null
			]);
		}

		function SettingsSection({ t }) {
			return react.createElement(SettingsPanel, { t });
		}
		//#endregion

		//#region component
		function formatInterval(ms, t) {
			const minutes = Math.round(ms / 60000);
			return minutes >= 1 ? t("unit.minutes", { n: minutes }) : t("unit.seconds", { n: Math.round(ms / 1000) });
		}

		const OPENCODE_WINDOW_KEYS = ["rolling", "weekly", "monthly"];
		function usageWindowKeys(usage) {
			const keys = Object.keys(usage ?? {}).filter((key) => usage?.[key] && typeof usage[key] === "object");
			return [...OPENCODE_WINDOW_KEYS.filter((key) => keys.includes(key)), ...keys.filter((key) => !OPENCODE_WINDOW_KEYS.includes(key))];
		}
		function opencodeWindowName(key, t) {
			return key === "rolling" ? t("quota.rolling") : key === "weekly" ? t("quota.weekly") : key === "monthly" ? t("quota.monthly") : String(key).replace(/[_-]+/g, " ");
		}
		/** OpenCode Go 用量 → 剩余额度状态(取三个窗口中剩余最少者)。 */
		function opencodeQuotaStatus(usage, thresholds) {
			const remaining = usageWindowKeys(usage)
				.map((key) => usage?.[key]?.percent)
				.filter((n) => Number.isFinite(n))
				.map((n) => Math.max(0, Math.min(100, 100 - n)));
			if (remaining.length === 0) return { available: false, minRemaining: null, level: "danger" };
			const minRemaining = Math.min(...remaining);
			return { available: true, minRemaining, level: getStatusLevel(minRemaining, true, thresholds) };
		}
		function opencodeWindowLevel(percent, thresholds) {
			if (!Number.isFinite(percent)) return "danger";
			return getStatusLevel(Math.max(0, Math.min(100, 100 - percent)), true, thresholds);
		}
		/** 通用 metric 的剩余百分比（value/total），无 total 时回退 percent 字段。 */
		function metricPercent(metric) {
			const total = Number(metric?.total);
			const value = Number(metric?.value);
			if (Number.isFinite(total) && total > 0 && Number.isFinite(value)) {
				return value / total * 100;
			}
			const direct = Number(metric?.percent);
			return Number.isFinite(direct) ? direct : null;
		}
		/** 通用 metric 列表 → 剩余额度状态（取最小剩余）。 */
		function metricsQuotaStatus(metrics, thresholds) {
			const samples = (metrics ?? []).map((metric) => {
				const percent = metricPercent(metric);
				if (Number.isFinite(percent)) return { value: percent, percent: true };
				const value = Number(metric?.value);
				return Number.isFinite(value) ? { value, percent: false } : null;
			}).filter(Boolean);
			if (samples.length === 0) return { available: false, minRemaining: null, level: "danger" };
			const rank = { danger: 0, warning: 1, success: 2 };
			const level = samples
				.map((sample) => getStatusLevel(sample.value, true, thresholds))
				.reduce((worst, current) => rank[current] < rank[worst] ? current : worst, "success");
			const minRemaining = samples.every((sample) => sample.percent)
				? Math.min(...samples.map((sample) => sample.value))
				: null;
			return { available: true, minRemaining, level };
		}
		function metricLevel(metric, thresholds) {
			const percent = metricPercent(metric);
			if (Number.isFinite(percent)) return getStatusLevel(percent, true, thresholds);
			const value = Number(metric?.value);
			return Number.isFinite(value) ? getStatusLevel(value, true, thresholds) : "danger";
		}
		function formatMetricValue(metric) {
			const value = Number(metric?.value);
			const unit = typeof metric?.unit === "string" ? metric.unit : "";
			if (!Number.isFinite(value)) return "—";
			return String(value) + (unit ? " " + unit : "");
		}

		/** 多币种钱包: 底部列出选定货币 + 其他非零钱包; 卡片列出全部。 */
		function selectWallets(balances, preferred) {
			const list = Array.isArray(balances) ? balances.filter((b) => b && typeof b.currency === "string") : [];
			const preferredEntry = list.find((b) => b.currency === preferred);
			const others = list
				.filter((b) => b.currency !== preferred)
				.filter((b) => Number(b.total) > 0)
				.sort((a, b) => Number(b.total) - Number(a.total));
			const readout = preferredEntry ? [preferredEntry, ...others] : (others.length > 0 ? others : list);
			const card = preferredEntry
				? [preferredEntry, ...list.filter((b) => b.currency !== preferred)]
				: list;
			const statusWallet = preferredEntry ?? list.find((b) => Number(b.total) > 0) ?? list[0] ?? null;
			return { readout, card, statusWallet };
		}

		/**
		 * 余额读数: 与统计条同行的右对齐读数。
		 * 包含余额指示灯、本会话消耗、可选悬停双栏卡片与 V4 定价卡片。
		 * 设置入口在官方设置页的「额度」卡片。
		 */
		function toLocalInput(ms) {
			const d = new Date(ms);
			if (Number.isNaN(d.getTime())) return "";
			const p = (n) => String(n).padStart(2, "0");
			return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
		}

		const SpendCapsule = react.memo(function SpendCapsule({ t }) {
			const snap = react.useSyncExternalStore(spendStore.subscribe, spendStore.getSnapshot, spendStore.getSnapshot);
			const [open, setOpen] = react.useState(false);
			const [pos, setPos] = react.useState(() => {
				const raw = readCapState();
				if (Number.isFinite(raw.right) && Number.isFinite(raw.bottom)) return { right: raw.right, bottom: raw.bottom };
				return { right: 20, bottom: 20 };
			});
			const drag = react.useRef(null);
			const payload = snap.status === "ok" ? snap.payload : null;
			const amount = formatMoney(payload?.cost ?? 0, payload?.currency ?? "CNY");
			const chips = [
				["today", t("spend.today")],
				["yesterday", t("spend.yesterday")],
				["week", t("spend.week")],
				["month", t("spend.month")],
				["custom", t("spend.custom")]
			];
			const lastMoved = react.useRef(false);
			const onDragStart = (e) => {
				if (e.button !== 0) return;
				if (e.target && typeof e.target.closest === "function" && e.target.closest("input, .dshqb_cap_chip, .dshqb_btn_icon")) return;
				lastMoved.current = false;
				drag.current = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom };
				const move = (ev) => {
					if (!drag.current) return;
					if (Math.abs(ev.clientX - drag.current.x) + Math.abs(ev.clientY - drag.current.y) > 4) lastMoved.current = true;
					setPos({
						right: Math.max(8, drag.current.right - (ev.clientX - drag.current.x)),
						bottom: Math.max(8, drag.current.bottom - (ev.clientY - drag.current.y))
					});
				};
				const up = () => {
					document.removeEventListener("mousemove", move);
					document.removeEventListener("mouseup", up);
					drag.current = null;
					setPos((p) => {
						writeCapState(p);
						return p;
					});
				};
				document.addEventListener("mousemove", move);
				document.addEventListener("mouseup", up);
			};
			const rangeLabel = (chips.find(([id]) => id === snap.range) || chips[0])[1];
			const body = open
				? react.createElement("div", { className: "dshqb_cap_panel", key: "panel" }, [
					react.createElement("div", { className: "dshqb_cap_head", key: "head" }, [
						react.createElement("span", { key: "t" }, t("spend.title")),
						react.createElement("button", {
							type: "button",
							className: "dshqb_btn_icon",
							key: "close",
							onClick: () => setOpen(false),
							title: t("spend.close")
						}, "×")
					]),
					react.createElement("div", { className: "dshqb_card_val_main", key: "amt" }, amount),
					react.createElement("div", { className: "dshqb_cap_chips", key: "chips" },
						chips.map(([id, label]) =>
							react.createElement("button", {
								type: "button",
								className: "dshqb_cap_chip" + (snap.range === id ? " dshqb_cap_chip_on" : ""),
								key: id,
								onClick: () => {
									if (id === "custom") {
										const now = Date.now();
										const from = snap.from || toLocalInput(now - (now % 86400000));
										const to = snap.to || toLocalInput(now);
										void spendStore.setRange("custom", from, to);
									} else {
										void spendStore.setRange(id, "", "");
									}
								}
							}, label)
						)
					),
					snap.range === "custom"
						? react.createElement("div", { className: "dshqb_cap_custom", key: "custom" }, [
							react.createElement("label", { key: "from" }, [
								t("spend.from"),
								react.createElement("input", {
									type: "datetime-local",
									className: "dshqb_input",
									value: snap.from,
									onChange: (e) => void spendStore.setRange("custom", e.target.value, snap.to)
								})
							]),
							react.createElement("label", { key: "to" }, [
								t("spend.to"),
								react.createElement("input", {
									type: "datetime-local",
									className: "dshqb_input",
									value: snap.to,
									onChange: (e) => void spendStore.setRange("custom", snap.from, e.target.value)
								})
							])
						])
						: null,
					payload && payload.calls > 0
						? react.createElement("div", { key: "meta", className: "dshqb_card_sub" }, t("spend.meta", { calls: payload.calls, sessions: payload.sessions }))
						: react.createElement("div", { key: "empty", className: "dshqb_card_sub" }, t("spend.empty")),
					payload && payload.costByModel
						? react.createElement("ul", { className: "dshqb_card_models", key: "models" },
							Object.entries(payload.costByModel).map(([m, c]) =>
								react.createElement("li", { key: m }, [
									react.createElement("span", { key: "m" }, "• " + m),
									react.createElement("span", { key: "c" }, formatMoney(c, payload.currency ?? "CNY"))
								])
							)
						)
						: null
				])
				: react.createElement("button", {
					type: "button",
					className: "dshqb_cap_pill",
					key: "pill",
					title: t("spend.open"),
					onClick: () => { if (!lastMoved.current) setOpen(true); }
				}, t("spend.pill", { range: rangeLabel, amount }));
			return react.createElement("div", {
				className: "dshqb_cap",
				style: { right: pos.right + "px", bottom: pos.bottom + "px" },
				onMouseDown: onDragStart,
				key: "cap"
			}, body);
		});

		const BalanceReadout = react.memo(function BalanceReadout({ useProjection, t, session, sessionId }) {
			const rawCost = useProjection("queryCreditsCost");
			const liveUsage = useProjection("liveTokenUsage");
			const balance = react.useSyncExternalStore(balanceStore.subscribe, balanceStore.getSnapshot, balanceStore.getSnapshot);
			const resolver = react.useSyncExternalStore(
				(fn) => {
					modelDirListeners.add(fn);
					return () => modelDirListeners.delete(fn);
				},
				() => modelDirectories,
				() => null
			);
			const sid = sessionId ?? session?.sessionId ?? null;
			let directory = null;
			if (resolver && sid) {
				try { directory = resolver.directoryFor(sid); } catch { directory = null; }
			}
			const modelProvider = react.useSyncExternalStore(
				directory ? (fn) => directory.store.subscribe(fn) : noopSubscribe,
				() => {
					const current = directory?.store.getSnapshot()?.current;
					return typeof current?.provider === "string" ? current.provider : null;
				},
				() => null
			);
			react.useEffect(() => {
				if (!directory || typeof directory.load !== "function") return;
				if (directory.store.getSnapshot()?.current == null) void directory.load().catch(() => {});
			}, [directory]);
			const fallbackProvider = balance.status === "ok"
				? (balance.payload?.defaultProvider ?? balance.payload?.provider)
				: null;
			const payload = balance.status === "ok" ? balance.payload : null;
			const featureEnabled = payload?.enabled !== false;
			const providerQuotaMap = payload?.providerQuotaMap && typeof payload.providerQuotaMap === "object" ? payload.providerQuotaMap : null;
			const providerQuotaMapEntry = providerQuotaMap && modelProvider
				? Object.entries(providerQuotaMap).find(([providerId]) => normalizeProvider(providerId) === normalizeProvider(modelProvider))
				: null;
			const quotaSource = providerQuotaMap
				? (providerQuotaMapEntry?.[1] || null)
				: resolveQuotaSource(modelProvider, {
					quotaMode: payload?.quotaMode,
					provider: fallbackProvider
				}, payload?.quotaSources);
			const quotaSourceView = payload?.views?.[quotaSource];
			const quotaSourceKind = quotaSourceView?.kind || (quotaSource === "opencode-go" ? "usage" : "balance");
			const showDock = payload?.showDock !== false;
			const dockLayout = normalizeDockLayout(payload?.dockLayout);
			const showCapsule = payload?.showCapsule !== false;
			const showPopover = payload?.showPopover !== false;
			const showTps = payload?.showTps !== false;
			const cost = priceSession(rawCost, payload);
			const rootRef = react.useRef(null);

			// 峰谷切换不依赖额度接口轮询，避免跨过 09:00/12:00/14:00/18:00 后徽章滞后。
			const [tariffNow, setTariffNow] = react.useState(() => Date.now());
			react.useEffect(() => {
				const timer = setInterval(() => setTariffNow(Date.now()), 30000);
				return () => clearInterval(timer);
			}, []);
			if (!featureEnabled) return null;
			const isRefreshing = balance.isRefreshing === true;
			const tariffPeriod = currentTariffPeriod(tariffNow);
			const tariffLabelKey = tariffPeriod === "peak" ? "tariff.peak" : "tariff.offPeak";
			const tariffTitleKey = tariffPeriod === "peak" ? "tariff.peakTitle" : "tariff.offPeakTitle";
			const tariffBadge = react.createElement(HoverTooltip, {
				content: t(tariffTitleKey),
				className: "dshqb_tariff_wrap",
				key: "tariff_wrap"
			}, react.createElement("button", {
				type: "button",
				className: "dshqb_card_badge dshqb_card_badge_btn dshqb_tariff_badge dshqb_tariff_" + (tariffPeriod === "peak" ? "peak" : "offpeak"),
				"aria-label": t(tariffTitleKey),
				key: "tariff"
			}, t(tariffLabelKey)));
			const handleRefresh = (e) => {
				if (e) {
					e.stopPropagation();
					e.preventDefault();
				}
				void balanceStore.forceRefresh(quotaSource);
			};

			let balNode = null;
			let leftCol = null;

			// 1. 账户余额读数节点与左栏卡片内容
			if (balance.status === "ok" && quotaSource !== null) {
				const info = mergeQuotaView(balance.payload, quotaSource);
				if (info.ok === true && info.usage && (quotaSourceKind === "usage" || info.kind === "usage")) {
					const usage = info.usage || {};
					const windowKeys = usageWindowKeys(usage);
					const isOpenCodeGo = quotaSource === "opencode-go";
					const refreshLabel = isOpenCodeGo ? t("btn.refreshQuota") : t("btn.refreshCustom");
					const refreshingLabel = isOpenCodeGo ? t("btn.refreshingQuota") : t("btn.refreshingCustom");
					const quota = opencodeQuotaStatus(usage, info.thresholds);
					const level = quota.available ? quota.level : "danger";
					const levelText = level === "success" ? t("status.sufficient") : level === "warning" ? t("status.warning") : t("status.danger");
					const statusDot = react.createElement(HoverTooltip, {
						content: isRefreshing ? refreshingLabel : refreshLabel,
						key: "status_tip"
					}, react.createElement("button", {
						type: "button",
						className: "dshqb_dot dshqb_dot_btn dshqb_dot_" + level + (isRefreshing ? " dshqb_dot_loading" : ""),
						"aria-label": isRefreshing ? refreshingLabel : refreshLabel,
						onClick: handleRefresh,
						disabled: isRefreshing
					}));
					const readout = isOpenCodeGo
						? t("quota.readout", {
							monthly: formatPercent(usage.monthly?.percent),
							weekly: formatPercent(usage.weekly?.percent),
							rolling: formatPercent(usage.rolling?.percent)
						})
						: t("quota.readoutCustom", {
							name: info.name || quotaSource,
							windows: windowKeys.map((key) => opencodeWindowName(key, t) + " " + formatPercent(usage[key]?.percent)).join(" · ")
						});
					balNode = react.createElement("span", { className: "dshqb_amount", key: "bal" }, statusDot, readout);
					leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
						react.createElement("div", { className: "dshqb_card_header", key: "head" }, [
							react.createElement("span", { className: "dshqb_card_title", key: "title" }, isOpenCodeGo ? t("quota.cardTitle") : "🧾 " + (info.name || quotaSource)),
							react.createElement("span", { className: "dshqb_card_badges", key: "badges" }, [
								tariffBadge,
								react.createElement(HoverTooltip, {
									content: isRefreshing ? refreshingLabel : refreshLabel,
									key: "badge_tip"
								}, react.createElement("button", {
									type: "button",
									className: "dshqb_card_badge dshqb_card_badge_btn dshqb_card_badge_" + level,
									onClick: handleRefresh,
									disabled: isRefreshing
								}, quota.available ? t("quota.remaining", { percent: formatPercent(quota.minRemaining) }) : t("quota.unavailable")))
							])
						]),
						react.createElement("div", { className: "dshqb_quota_rows", key: "rows" },
							windowKeys.map((key) => {
								const w = usage[key] || {};
								const wLevel = opencodeWindowLevel(w.percent, info.thresholds);
								const pct = Number.isFinite(w.percent) ? Math.max(0, Math.min(100, w.percent)) : 0;
								return react.createElement("div", { className: "dshqb_quota_row", key },
									react.createElement("div", { className: "dshqb_quota_head", key: "head" }, [
										react.createElement("span", { className: "dshqb_quota_name", key: "name" }, opencodeWindowName(key, t)),
										react.createElement(HoverTooltip, {
											content: isRefreshing ? refreshingLabel : refreshLabel,
											key: "pct_tip"
										}, react.createElement("button", {
											type: "button",
											className: "dshqb_quota_pct dshqb_quota_pct_btn",
											onClick: handleRefresh,
											disabled: isRefreshing
										}, formatPercent(w.percent)))
									]),
									react.createElement("div", { className: "dshqb_quota_track", key: "track" },
										react.createElement("div", {
											className: "dshqb_quota_fill" + (wLevel === "danger" ? " dshqb_quota_fill_danger" : wLevel === "warning" ? " dshqb_quota_fill_warning" : ""),
											style: { width: pct + "%" },
											key: "fill"
										})
									),
									react.createElement("div", { className: "dshqb_quota_meta", key: "meta" }, [
										react.createElement("span", { key: "reset" }, t("quota.resets", { time: formatResetTime(w.resetsAt) }))
									])
								);
							})
						),
						react.createElement("div", { className: "dshqb_card_hint", key: "hint" }, [
							react.createElement("div", { key: "time" }, t("card.updated", { time: formatClock(info.fetchedAt), interval: formatInterval(info.refreshIntervalMs ?? DEFAULT_POLL_MS, t) })),
							react.createElement("div", { key: "tip" }, t("card.refreshHint"))
						])
					]);
				} else if (quotaSourceKind === "usage") {
					const isOpenCodeGo = quotaSource === "opencode-go";
					const refreshLabel = isOpenCodeGo ? t("btn.refreshQuota") : t("btn.refreshCustom");
					const refreshingLabel = isOpenCodeGo ? t("btn.refreshingQuota") : t("btn.refreshingCustom");
					const message = info.error === "api-key-missing" ? t("balanceMissing") : (isOpenCodeGo ? t("quota.unavailable") : t("quota.unavailableCustom"));
					const statusDot = react.createElement(HoverTooltip, {
						content: isRefreshing ? refreshingLabel : refreshLabel,
						key: "status_tip"
					}, react.createElement("button", {
						type: "button",
						className: "dshqb_dot dshqb_dot_btn dshqb_dot_danger" + (isRefreshing ? " dshqb_dot_loading" : ""),
						"aria-label": isRefreshing ? refreshingLabel : refreshLabel,
						onClick: handleRefresh,
						disabled: isRefreshing
					}));
					balNode = react.createElement("span", { className: "dshqb_error", key: "bal" }, statusDot, message);
					leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
						react.createElement("div", { className: "dshqb_card_header", key: "head" }, react.createElement("span", { className: "dshqb_card_title" }, isOpenCodeGo ? t("quota.cardTitle") : "🧾 " + (info.name || quotaSource))),
						react.createElement("div", { className: "dshqb_card_sub", key: "err" }, t(isOpenCodeGo ? "quota.error" : "quota.errorCustom", { error: typeof info.error === "string" ? info.error : message }))
					]);
				} else if ((quotaSourceKind === "balance" || info.kind === "balance") && info.ok === true && Array.isArray(info.balances) && info.balances.length > 0) {
					const wallets = selectWallets(info.balances, info.currency);
					const primary = wallets.statusWallet ?? info.balances[0];
					const amount = wallets.readout.map((w) => formatMoney(w.total, w.currency)).join(" · ");
					const level = getStatusLevel(primary.total, info.isAvailable === true, info.thresholds);
					const levelText = level === "success" ? t("status.sufficient") : level === "warning" ? t("status.warning") : t("status.danger");
					const statusDot = react.createElement(HoverTooltip, {
						content: isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
						key: "status_tip"
					}, react.createElement("button", {
						type: "button",
						className: "dshqb_dot dshqb_dot_btn dshqb_dot_" + level + (isRefreshing ? " dshqb_dot_loading" : ""),
						"aria-label": isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
						onClick: handleRefresh,
						disabled: isRefreshing
					}));
					const balanceSourceName = info.name || quotaSource;
					balNode = react.createElement("span", { className: "dshqb_amount", key: "bal" }, statusDot,
						info.providerId ? t("balance.readoutCustom", { name: balanceSourceName, amount }) : t("balance", { amount }));

					leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
						react.createElement("div", { className: "dshqb_card_header", key: "head" }, [
							react.createElement("span", { className: "dshqb_card_title", key: "title" }, info.providerId ? "📊 " + balanceSourceName : t("card.balanceTitle")),
							react.createElement("span", { className: "dshqb_card_badges", key: "badges" }, [
								tariffBadge,
								react.createElement(HoverTooltip, {
									content: isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
									key: "badge_tip"
								}, react.createElement("button", {
									type: "button",
									className: "dshqb_card_badge dshqb_card_badge_btn dshqb_card_badge_" + level,
									onClick: handleRefresh,
									disabled: isRefreshing
								}, "● " + levelText))
							])
						]),
						react.createElement("div", { className: "dshqb_wallets", key: "wallets" },
							wallets.card.map((w) =>
								react.createElement("div", { className: "dshqb_wallet", key: w.currency }, [
									react.createElement("div", { className: "dshqb_wallet_head", key: "head" }, [
										react.createElement("span", { className: "dshqb_wallet_code", key: "code" }, t("card.wallet", { currency: w.currency })),
										react.createElement("span", { className: "dshqb_card_val_main", key: "val" }, formatMoney(w.total, w.currency))
									]),
									react.createElement("div", { className: "dshqb_card_sub", key: "sub" }, [
										react.createElement("span", { key: "top" }, t("card.topup", { amount: formatMoney(w.toppedUp, w.currency) })),
										react.createElement("span", { key: "sep" }, "·"),
										react.createElement("span", { key: "gra" }, t("card.granted", { amount: formatMoney(w.granted, w.currency) }))
									])
								])
							)
						),
						react.createElement("div", { className: "dshqb_card_hint", key: "hint" }, [
							react.createElement("div", { key: "time" }, t("card.updated", { time: formatClock(info.fetchedAt), interval: formatInterval(info.refreshIntervalMs ?? DEFAULT_POLL_MS, t) })),
							react.createElement("div", { key: "tip" }, t("card.refreshHint"))
						])
					]);
				} else if ((quotaSourceKind === "metric" || info.kind === "metric") && info.ok === true && Array.isArray(info.metrics) && info.metrics.length > 0) {
					const metrics = info.metrics || [];
					const customSourceName = info.name || info.sourceName || quotaSource;
					const quota = metricsQuotaStatus(metrics, info.thresholds);
					const level = quota.available ? quota.level : "danger";
					const levelText = level === "success" ? t("status.sufficient") : level === "warning" ? t("status.warning") : t("status.danger");
					const statusDot = react.createElement(HoverTooltip, {
						content: isRefreshing ? t("btn.refreshingCustom") : t("btn.refreshCustom"),
						key: "status_tip"
					}, react.createElement("button", {
						type: "button",
						className: "dshqb_dot dshqb_dot_btn dshqb_dot_" + level + (isRefreshing ? " dshqb_dot_loading" : ""),
						"aria-label": isRefreshing ? t("btn.refreshingCustom") : t("btn.refreshCustom"),
						onClick: handleRefresh,
						disabled: isRefreshing
					}));
					const metricReadout = metrics
						.map((m) => {
							const p = metricPercent(m);
							const label = m.label ? m.label + " " : "";
							return p !== null ? label + formatPercent(p) : label + formatMetricValue(m);
						})
						.join(" · ");
					const readout = customSourceName ? customSourceName + " · " + metricReadout : metricReadout;
					balNode = react.createElement("span", { className: "dshqb_amount", key: "bal" }, statusDot, readout);
					leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
						react.createElement("div", { className: "dshqb_card_header", key: "head" }, [
							react.createElement("span", { className: "dshqb_card_title", key: "title" }, "🎯 " + customSourceName),
							react.createElement("span", { className: "dshqb_card_badges", key: "badges" }, [
								tariffBadge,
								react.createElement(HoverTooltip, {
									content: isRefreshing ? t("btn.refreshingCustom") : t("btn.refreshCustom"),
									key: "badge_tip"
								}, react.createElement("button", {
									type: "button",
									className: "dshqb_card_badge dshqb_card_badge_btn dshqb_card_badge_" + level,
									onClick: handleRefresh,
									disabled: isRefreshing
								}, quota.available
									? (Number.isFinite(quota.minRemaining) ? t("quota.remaining", { percent: formatPercent(quota.minRemaining) }) : "● " + levelText)
									: t("quota.unavailableCustom")))
							])
						]),
						react.createElement("div", { className: "dshqb_quota_rows", key: "rows" },
							metrics.map((m, i) => {
								const pct = metricPercent(m);
								const wLevel = metricLevel(m, info.thresholds);
								const bar = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
								return react.createElement("div", { className: "dshqb_quota_row", key: m.key || i },
									react.createElement("div", { className: "dshqb_quota_head", key: "head" }, [
										react.createElement("span", { className: "dshqb_quota_name", key: "name" }, m.label || m.key || "Quota"),
										react.createElement(HoverTooltip, {
											content: isRefreshing ? t("btn.refreshingCustom") : t("btn.refreshCustom"),
											key: "pct_tip"
										}, react.createElement("button", {
											type: "button",
											className: "dshqb_quota_pct dshqb_quota_pct_btn",
											onClick: handleRefresh,
											disabled: isRefreshing
										}, pct !== null ? formatPercent(pct) : formatMetricValue(m)))
									]),
									Number.isFinite(pct) ? react.createElement("div", { className: "dshqb_quota_track", key: "track" },
										react.createElement("div", {
											className: "dshqb_quota_fill" + (wLevel === "danger" ? " dshqb_quota_fill_danger" : wLevel === "warning" ? " dshqb_quota_fill_warning" : ""),
											style: { width: bar + "%" },
											key: "fill"
										})
									) : null,
									react.createElement("div", { className: "dshqb_quota_meta", key: "meta" }, [
										m.resetsAt
											? react.createElement("span", { key: "reset" }, t("quota.resets", { time: formatResetTime(m.resetsAt) }))
											: (Number(m.total) > 0 ? react.createElement("span", { key: "vt" }, t("quota.valueTotal", { value: m.value ?? "—", total: m.total, unit: m.unit || "" })) : null)
									])
								);
							})
						),
						react.createElement("div", { className: "dshqb_card_hint", key: "hint" }, [
							react.createElement("div", { key: "time" }, t("card.updated", { time: formatClock(info.fetchedAt), interval: formatInterval(info.refreshIntervalMs ?? DEFAULT_POLL_MS, t) })),
							react.createElement("div", { key: "tip" }, t("card.refreshHint"))
						])
					]);
				} else {
					const isCustom = quotaSourceKind === "metric";
					const customSourceName = info.name || info.sourceName || quotaSource;
					const message = info.error === "api-key-missing" ? t("balanceMissing") : (isCustom ? t("quota.unavailableCustom") : t("balanceError"));
					const statusDot = react.createElement("button", {
						type: "button",
						className: "dshqb_dot dshqb_dot_btn dshqb_dot_danger" + (isRefreshing ? " dshqb_dot_loading" : ""),
						"aria-label": isRefreshing ? (isCustom ? t("btn.refreshingCustom") : t("btn.refreshing")) : t("btn.refresh"),
						title: isRefreshing ? (isCustom ? t("btn.refreshingCustom") : t("btn.refreshing")) : t("btn.refresh"),
						onClick: handleRefresh,
						disabled: isRefreshing
					});
					balNode = react.createElement("span", { className: "dshqb_error", key: "bal" }, statusDot, message);
					leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
						react.createElement("div", { className: "dshqb_card_header", key: "head" }, react.createElement("span", { className: "dshqb_card_title" }, isCustom || info.providerId ? "🎯 " + customSourceName : t("card.balanceTitle"))),
						react.createElement("div", { className: "dshqb_card_sub", key: "err" }, isCustom ? t("quota.errorCustom", { error: typeof info.error === "string" ? info.error : message }) : t("card.error", { error: typeof info.error === "string" ? info.error : message }))
					]);
				}
			} else if (balance.status === "error") {
				const statusDot = react.createElement("button", {
					type: "button",
					className: "dshqb_dot dshqb_dot_btn dshqb_dot_danger" + (isRefreshing ? " dshqb_dot_loading" : ""),
					"aria-label": isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
					title: isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
					onClick: handleRefresh,
					disabled: isRefreshing
				});
				balNode = react.createElement("span", { className: "dshqb_error", key: "bal" }, statusDot, t("balanceError"));
				leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
					react.createElement("div", { className: "dshqb_card_header", key: "head" }, react.createElement("span", { className: "dshqb_card_title" }, t("card.balanceTitle"))),
					react.createElement("div", { className: "dshqb_card_sub", key: "err" }, t("card.error", { error: balance.message }))
				]);
			}

			// 2. 本会话消耗读数节点与右栏卡片内容
			let costNode = null;
			const hasCost = cost !== undefined && cost.cost > 0;
			if (hasCost) {
				const amount = formatMoney(cost.cost, cost.currency ?? "CNY");
				costNode = react.createElement("span", { className: "dshqb_amount", key: "cost" }, t("sessionCost", { amount }));
			}
			const hasTps = showTps && Number.isFinite(liveUsage?.tokensPerSecond) && liveUsage.tokensPerSecond > 0;
			const tpsNode = hasTps
				? react.createElement("span", { className: "dshqb_amount dshqb_tps", key: "tps" }, t("tps", { rate: formatTokensPerSecond(liveUsage.tokensPerSecond) }))
				: null;

			const rightCol = react.createElement("div", { className: "dshqb_col", key: "right" }, [
				react.createElement("div", { className: "dshqb_card_header", key: "head" }, [
					react.createElement("span", { className: "dshqb_card_title", key: "title" }, t("card.sessionTitle")),
					react.createElement("span", { className: "dshqb_card_val_main", key: "val" }, hasCost ? formatMoney(cost.cost, cost.currency ?? "CNY") : formatMoney(0, cost?.currency ?? "CNY"))
				]),
				hasCost
					? react.createElement("ul", { className: "dshqb_card_models", key: "models" },
						(cost.models ?? []).filter((m) => (cost.costByModel[m] ?? 0) > 0).map((m, i) =>
							react.createElement("li", { key: i }, [
								react.createElement("span", { key: "m" }, "• " + (m === "unknown" ? t("model.unknown") : m)),
								react.createElement("span", { key: "c" }, formatMoney(cost.costByModel[m], cost.currency ?? "CNY"))
							])
						)
					)
					: react.createElement("div", { className: "dshqb_card_sub", key: "models" }, t("card.noCost")),
				react.createElement("div", { className: "dshqb_card_hint", key: "hint" }, [
					hasCost
						? (() => {
							const totalInput = (cost.tokens?.uncachedInput ?? 0) + (cost.tokens?.cacheRead ?? 0) + (cost.tokens?.cacheWrite ?? 0);
							const cacheHit = cost.tokens?.cacheRead ?? 0;
							const hitRate = totalInput > 0 ? (cacheHit / totalInput * 100).toFixed(1) : "0.0";
							return react.createElement("div", { className: "dshqb_card_tokens", key: "tok" }, [
								react.createElement("div", { key: "main" }, t("card.tokens", {
									input: formatTokens(totalInput),
									output: formatTokens(cost.tokens?.output ?? 0)
								})),
								cacheHit > 0
									? react.createElement("div", { className: "dshqb_card_hit", key: "hit" }, t("card.tokensHit", {
										hit: formatTokens(cacheHit),
										hitRate
									}))
									: null
							]);
						})()
						: null,
					react.createElement("div", { key: "tip" }, quotaSourceKind === "usage" ? t("card.sessionHintQuota") : quotaSourceKind === "metric" ? t("card.sessionHintCustom") : t("card.pricingHint"))
				])
			]);

			// 3. 定价策略 "?" 图标与毛玻璃卡片 (仅 DeepSeek 官方余额展示)
			let pricingNode = null;
			if (balance.status === "ok" && balance.payload !== null && quotaSourceKind === "balance") {
				const payload = balance.payload;
				const currency = typeof payload.currency === "string" ? payload.currency : "CNY";
				const prices = payload.prices !== null && typeof payload.prices === "object" ? payload.prices : {};
				
				const table = v4TableFor(currency);
				const names = [];
				for (const m of PINNED_V4_MODELS) names.push(m);
				for (const m of Object.keys(prices)) {
					if (!names.includes(m) && (m.toLowerCase().includes("v4") || hasTariffTiers(prices[m]))) names.push(m);
				}
				const nowPeriod = currentTariffPeriod();
				const rateLine = (kind, p) => react.createElement("div", {
					className: "dshqb_pricing_tier_row" + (nowPeriod === kind ? " is-current" : ""),
					key: kind
				}, [
					react.createElement("span", {
						className: "dshqb_period_tag " + (kind === "peak" ? "dshqb_period_peak" : "dshqb_period_offpeak"),
						key: "tag"
					}, t(kind === "peak" ? "tariff.peak" : "tariff.offPeak")),
					react.createElement("span", { key: "hit" }, t("pricing.hit", { price: formatPrice(p.cacheHit, currency) })),
					react.createElement("span", { className: "dshqb_pricing_dot", key: "d1" }, "·"),
					react.createElement("span", { key: "miss" }, t("pricing.miss", { price: formatPrice(p.cacheMiss, currency) })),
					react.createElement("span", { className: "dshqb_pricing_dot", key: "d2" }, "·"),
					react.createElement("span", { key: "out" }, t("pricing.output", { price: formatPrice(p.output, currency) }))
				]);

				const pricingPopover = react.createElement("div", {
					className: "dshqb_pricing_popover",
					key: "pricing_popover"
				}, [
					react.createElement("div", { className: "dshqb_card_header", key: "head" }, [
						react.createElement("span", { className: "dshqb_card_title", key: "title" }, t("pricing.title")),
						react.createElement("span", { className: "dshqb_card_badge dshqb_card_badge_info", key: "badge" }, t("pricing.rateBadge", { currency }))
					]),
					react.createElement("div", { className: "dshqb_pricing_models", key: "models" },
						names.map((model, idx) => {
							const stored = prices[model];
							const tiers = hasTariffTiers(stored)
								? { peak: stored.peak, offPeak: stored.offPeak }
								: (PINNED_V4_MODELS.includes(model) && table[model]
									? { peak: table[model].peak, offPeak: table[model].offPeak }
									: null);
							return react.createElement("div", { className: "dshqb_pricing_card_item", key: idx }, [
								react.createElement("div", { className: "dshqb_pricing_model_name", key: "name" }, "• " + model),
								tiers
									? [rateLine("peak", tiers.peak), rateLine("offPeak", tiers.offPeak)]
									: react.createElement("div", { className: "dshqb_pricing_rates", key: "rates" }, [
										react.createElement("span", { key: "hit" }, t("pricing.hit", { price: formatPrice(stored?.cacheHit, currency) })),
										react.createElement("span", { className: "dshqb_pricing_dot", key: "d1" }, "·"),
										react.createElement("span", { key: "miss" }, t("pricing.miss", { price: formatPrice(stored?.cacheMiss, currency) })),
										react.createElement("span", { className: "dshqb_pricing_dot", key: "d2" }, "·"),
										react.createElement("span", { key: "out" }, t("pricing.output", { price: formatPrice(stored?.output, currency) }))
									])
							]);
						})
					),
					react.createElement("a", {
						className: "dshqb_pricing_link",
						key: "link",
						href: PRICING_URL,
						target: "_blank",
						rel: "noreferrer"
					}, t("pricing.link"))
				]);

				pricingNode = react.createElement("span", {
					className: "dshqb_pricing_wrap",
					key: "pricing_wrap"
				}, [
					react.createElement("a", {
						className: "dshqb_btn_icon",
						key: "btn",
						href: PRICING_URL,
						target: "_blank",
						rel: "noreferrer",
						"aria-label": t("pricing.aria"),
						title: t("pricing.aria"),
						children: react.createElement(_ui_primitives.IconQuestionOutline14, { size: 14 })
					}),
					pricingPopover
				]);
			}

			const capsuleNode = showCapsule
				? (showDock
					? react.createElement(SpendCapsule, { t, key: "cap" })
					: react.createElement("div", { className: "dshqb_host", key: "cap_host" }, react.createElement(SpendCapsule, { t })))
				: null;

			if (!showDock) {
				return capsuleNode;
			}

			const popover = showPopover && leftCol !== null ? react.createElement("div", {
				className: "dshqb_popover",
				key: "popover"
			}, [
				leftCol,
				react.createElement("div", { className: "dshqb_vsep", key: "vsep" }),
				rightCol
			]) : null;

			const triggerChildren = [];
			if (balNode !== null) triggerChildren.push(balNode);
			if (costNode !== null) {
				if (triggerChildren.length > 0) triggerChildren.push(react.createElement("span", { className: "dshqb_sep", "aria-hidden": true, key: "sep_cost" }, "|"));
				triggerChildren.push(costNode);
			}
			if (tpsNode !== null) {
				if (triggerChildren.length > 0) triggerChildren.push(react.createElement("span", { className: "dshqb_sep", "aria-hidden": true, key: "sep_tps" }, "|"));
				triggerChildren.push(tpsNode);
			}
			if (popover !== null) triggerChildren.push(popover);

			if (triggerChildren.length === 0 && pricingNode === null) {
				return capsuleNode;
			}

			const triggerWrapper = react.createElement("span", {
				className: "dshqb_trigger",
				key: "trigger"
			}, triggerChildren);

			const rootChildren = [triggerWrapper];
			if (pricingNode !== null) {
				rootChildren.push(react.createElement("span", { className: "dshqb_sep", "aria-hidden": true, key: "sep_pricing" }, "|"));
				rootChildren.push(pricingNode);
			}

			if (capsuleNode !== null) rootChildren.push(capsuleNode);
			return react.createElement("div", {
				ref: rootRef,
				className: "dshqb_root",
				"data-dshqb-dock": "",
				"data-dshqb-layout": dockLayout,
				key: "bar",
				children: rootChildren
			});
		});
		//#endregion

		//#region plugin
		const inject = ["slots", "locale"];

		function settingsNavKind(label) {
			const text = String(label ?? "").replace(/\s+/g, " ").trim();
			if (text === "额度" || text === "Credits") return "credits";
			if (text === "Web UI 插件" || text === "Web UI Plugins") return "webui";
			if (text === "皮肤中心" || text === "Skin Center") return "skin";
			if (text === "宠物" || text === "Pet") return "pet";
			if (text === "社区插件" || text === "Community Plugins") return "community";
			return "";
		}
		function syncSettingsNavIcons() {
			if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
			const lists = document.querySelectorAll("[class*='_navList']");
			for (const list of lists) {
				const cells = list.querySelectorAll(":scope > [class*='_navCell']");
				for (const cell of cells) {
					const kind = settingsNavKind(cell.textContent);
					if (kind) cell.setAttribute("data-dshqb-nav", kind);
					else cell.removeAttribute("data-dshqb-nav");
				}
			}
		}
		function startSettingsNavIconSync() {
			if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return () => {};
			const run = () => {
				try { syncSettingsNavIcons(); } catch { /* 设置页未挂载时忽略 */ }
			};
			run();
			if (typeof MutationObserver !== "function") return () => {};
			const root = document.body || document.documentElement;
			if (!root) return () => {};
			const obs = new MutationObserver(run);
			obs.observe(root, { childList: true, subtree: true, characterData: true });
			return () => obs.disconnect();
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-credits: dictionaries");
			if (typeof ctx.inject === "function") {
				ctx.inject(["modelDirectories"], (scope) => {
					setModelDirectories(scope.modelDirectories ?? scope.get?.("modelDirectories"));
					return () => setModelDirectories(null);
				});
			}
			// 等待 ui-conversation 声明 composer.dock 槽位后再注册本条目。
			ctx.slots.inject("conversation.composer.dock", () => {
				const dispose = ctx.slots.register({
					name: "conversation.composer.dock",
					id: "dsh-credits",
					order: 1000,
					locale: NS
				}, BalanceReadout);
				return () => {
					dispose();
				};
			});
			ctx.slots.inject("settings.section", () => {
				const dispose = ctx.slots.register({
					name: "settings.section",
					id: "dsh-credits",
					order: 1000,
					label: () => ctx.locale.bind(NS)("settings.nav"),
					locale: NS
				}, SettingsSection);
				return () => {
					dispose();
				};
			});
			// 页面回到前台时立即刷新一次, 并在隐藏期间跳过定时器。
			ctx.effect(() => {
				const onVisibility = () => {
					if (!document.hidden) {
						refresh().then(schedule, schedule);
						refreshSpend().then(scheduleSpend, scheduleSpend);
					}
				};
				document.addEventListener("visibilitychange", onVisibility);
				return () => document.removeEventListener("visibilitychange", onVisibility);
			}, "dsh-credits: visibility resume");
			ctx.effect(() => startSettingsNavIconSync(), "dsh-credits: settings nav icons");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
