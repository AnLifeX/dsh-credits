/**
 * dsh-credits — browser half (lazy-CJS 客户端 bundle)。
 *
 * 在 `conversation.composer.dock`(输入框下方统计条所在行) 注册余额读数:
 *   - 余额: 单例轮询器按服务器下发的 `clientPollIntervalMs` 读取 `/query-credits`
 *     (只读缓存, 不直接访问 DeepSeek); 页面隐藏时暂停轮询。
 *   - 本会话消耗: 读取宿主推送的 `queryCreditsCost` 投影(按模型计价)。
 *   - 设置: 注册一级 `settings.section` 卡片(展示开关、额度模式、阈值、单价、YAML)。
 *
 * 额度模式: follow 跟随当前对话模型供应商; custom 固定官方余额或 Go 套餐额度。
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
				".dshqb_modal_header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.03));border-bottom:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.12)));font-size:15px;font-weight:600}",
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
				".dshqb_form_hint{display:block;font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.45;white-space:normal;overflow-wrap:anywhere}",
				".dshqb_input{background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.08)));border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.2)));border-radius:6px;padding:8px 12px;color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;width:100%;box-sizing:border-box;transition:border-color .15s ease,box-shadow .15s ease;outline:none}",
				".dshqb_input:focus{border-color:var(--dsw-alias-brand-primary,var(--dsw-alias-accent-primary,#3b82f6));box-shadow:0 0 0 2px rgba(59,130,246,0.2)}",
				".dshqb_select{background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.08)));border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.2)));border-radius:6px;padding:8px 12px;color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;width:100%;box-sizing:border-box;outline:none;cursor:pointer}",
				".dshqb_select option{background:var(--dsw-alias-bg-layer-1,#ffffff);color:var(--dsw-alias-label-primary)}",
				".dshqb_grid_2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;min-width:0}",
				".dshqb_grid_2>*{min-width:0}",
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
				".dshqb_pricing_table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.06))}",
				".dshqb_input_num{width:80px;padding:4px 8px;font-size:12px}",
				".dshqb_btn_del{color:var(--dsw-alias-state-error-primary,#ef4444);background:transparent;border:none;cursor:pointer;padding:2px 6px;border-radius:4px;font-size:13px;line-height:1;transition:background-color .15s ease}",
				".dshqb_btn_del:hover{background:rgba(239,68,68,0.12)}",
				".dshqb_add_model_box{display:flex;gap:8px;align-items:center;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.03));border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,0.2));border-radius:6px;padding:8px 10px;margin-top:8px}",
				".dshqb_code_block{background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.06)));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.15));border-radius:8px;padding:12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-primary);overflow-x:auto;white-space:pre;line-height:1.5;max-height:220px}",
				".dshqb_btn{padding:8px 16px;border-radius:6px;font-size:12.5px;font-weight:500;cursor:pointer;border:1px solid transparent;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:all .15s ease}",
				".dshqb_btn_primary{background:var(--dsw-alias-brand-primary,var(--dsw-alias-button-primary-fill,#3b82f6));color:var(--dsw-alias-label-primary-foreground,#ffffff);font-weight:600}",
				".dshqb_btn_primary:hover{filter:brightness(1.12)}",
				".dshqb_btn_secondary{background:var(--dsw-alias-button-tool-bar-fill,var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,0.1)));color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2,rgba(128,128,128,0.2))}",
				".dshqb_btn_secondary:hover{background:var(--dsw-alias-button-tool-bar-hover,var(--dsw-alias-interactive-bg-active,rgba(128,128,128,0.16)))}",
				".dshqb_btn_outline{background:transparent;border-color:var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.25)));color:var(--dsw-alias-label-secondary)}",
				".dshqb_btn_outline:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1,rgba(128,128,128,0.45));background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,0.06))}",
				".dshqb_modal_footer{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-top:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-secondary,rgba(128,128,128,0.12)));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.03))}",
				".dshqb_modal_footer_right{display:flex;gap:10px}",
				".dshqb_toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--dsw-alias-state-success-primary,#10b981);color:#ffffff;padding:8px 18px;border-radius:999px;box-shadow:var(--dsw-shadow-lv3,0 8px 24px rgba(0,0,0,0.3));font-size:12.5px;font-weight:500;z-index:100000;animation:dshqb-toast-in .2s ease-out;display:flex;align-items:center;gap:6px}",
				".dshqb_settings_page{position:relative;display:flex;flex-direction:column;min-width:0;width:100%;max-width:760px;box-sizing:border-box;white-space:normal;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.16));border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#ffffff))}",
				".dshqb_settings_page .dshqb_modal_header{background:transparent;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,0.12))}",
				".dshqb_toggle_list{display:flex;flex-direction:column;gap:0;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.12));border-radius:8px;padding:2px 14px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,0.04))}",
				".dshqb_toggle_row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:11px 0;cursor:pointer}",
				".dshqb_toggle_row+.dshqb_toggle_row{border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,0.08))}",
				".dshqb_toggle_copy{display:flex;flex-direction:column;gap:3px;min-width:0}",
				".dshqb_check{width:16px;height:16px;margin-top:2px;flex-shrink:0;accent-color:var(--dsw-alias-brand-primary,#3b82f6);cursor:pointer}",
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
		/** 仅 OpenCode Go 走订阅用量, 其余供应商(含 DeepSeek 官方)显示官方余额。 */
		function quotaSourceFromProvider(provider) {
			return String(provider ?? "").trim().toLowerCase() === "opencode-go" ? "opencode-go" : "deepseek";
		}
		/** follow: 跟当前模型; custom: 固定用 config.provider, 忽略当前模型。 */
		function resolveQuotaSource(modelProvider, config) {
			const selected = quotaSourceFromProvider(config?.provider);
			if (String(config?.quotaMode ?? "follow").trim().toLowerCase() === "custom") return selected;
			return quotaSourceFromProvider(modelProvider ?? config?.provider);
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
			if (source === "opencode-go") {
				delete next.balances;
				delete next.isAvailable;
			} else {
				delete next.usage;
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
		const V4_CNY = {
			"deepseek-v4-flash": { listed: { cacheHit: 0.02, cacheMiss: 1, output: 2 }, peak: { cacheHit: 0.10, cacheMiss: 3.0, output: 9.0 }, offPeak: { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 } },
			"deepseek-v4-pro": { listed: { cacheHit: 0.025, cacheMiss: 3, output: 6 }, peak: { cacheHit: 0.30, cacheMiss: 9.0, output: 27.0 }, offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 } }
		};
		const scaleUsd = (p) => ({ cacheHit: Math.round(p.cacheHit * 0.14 * 1e6) / 1e6, cacheMiss: Math.round(p.cacheMiss * 0.14 * 1e6) / 1e6, output: Math.round(p.output * 0.14 * 1e6) / 1e6 });
		const V4_USD = {
			"deepseek-v4-flash": { listed: scaleUsd(V4_CNY["deepseek-v4-flash"].listed), peak: scaleUsd(V4_CNY["deepseek-v4-flash"].peak), offPeak: scaleUsd(V4_CNY["deepseek-v4-flash"].offPeak) },
			"deepseek-v4-pro": { listed: scaleUsd(V4_CNY["deepseek-v4-pro"].listed), peak: scaleUsd(V4_CNY["deepseek-v4-pro"].peak), offPeak: scaleUsd(V4_CNY["deepseek-v4-pro"].offPeak) }
		};
		function isPeakBeijing(timestamp) {
			const hourBJT = (new Date(timestamp).getUTCHours() + 8) % 24;
			return (hourBJT >= 9 && hourBJT < 12) || (hourBJT >= 14 && hourBJT < 18);
		}
		function resolveClientPrice(cfg, model, timestamp) {
			const currency = cfg.currency || "CNY";
			const table = (currency === "USD" ? V4_USD : currency === "CNY" ? V4_CNY : null)?.[model];
			if (table) {
				if (timestamp < V4_CUTOFF_MS) return table.listed;
				return isPeakBeijing(timestamp) ? table.peak : table.offPeak;
			}
			return cfg.prices?.[model] ?? cfg.defaultPrices ?? { cacheHit: 0, cacheMiss: 0, output: 0 };
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
					if (source === "opencode-go" || source === "deepseek") params.push("source=" + encodeURIComponent(source));
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
				return refresh(true, source === "opencode-go" || source === "deepseek" ? source : null);
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
			"balanceError": "余额不可用",
			"balanceMissing": "未配置 API Key",
			"status.sufficient": "充足",
			"status.warning": "偏低",
			"status.danger": "告急",
			"btn.refresh": "点击立即刷新余额",
			"btn.refreshing": "正在刷新余额...",
			"sessionCost": "本会话约 {amount}",
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
			"card.error": "【账户余额】异常: {error}",
			/* OpenCode Go quota translations */
			"quota.readout": "Go 额度 月 {monthly} · 周 {weekly} · 5h {rolling}",
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
			"settings.tab.general": "🎯 常规与阈值",
			"settings.tab.pricing": "⚡ 模型单价",
			"settings.tab.export": "📋 YAML 导出",
			"settings.showDock": "底部统计条",
			"settings.showDockHint": "在输入框下方展示额度读数与本会话消耗。关掉后只保留 Web UI 自己的统计。",
			"settings.dockLayout": "底部条布局",
			"settings.dockLayout.own": "独立换行",
			"settings.dockLayout.shared": "共用一行",
			"settings.dockLayoutHint": "独立换行：额度单独占底下一行。共用一行：跟官方统计、TPS 排在同一行最后面。",
			"settings.showCapsule": "累计消耗胶囊",
			"settings.showCapsuleHint": "右下角可拖拽的今天/本周/本月累计消耗。",
			"settings.showPopover": "悬停详情气泡",
			"settings.showPopoverHint": "鼠标悬停底部读数时弹出余额/额度与本会话明细。",
			"settings.quotaMode": "额度查询模式",
			"settings.quotaMode.follow": "跟随当前模型供应商",
			"settings.quotaMode.custom": "自定义固定展示",
			"settings.quotaModeHint": "跟随：Go 模型显示套餐额度，其他供应商显示官方余额。自定义：始终按下方数据源展示，不随模型切换。",
			"settings.currency": "计价货币",
			"settings.currencyHint": "影响本会话估算与状态灯。所有钱包都会列出；切换后套用该币种官方单价。",
			"settings.currencyHintQuota": "不影响额度百分比，只改右侧本会话估算。",
			"settings.warning": "预警阈值 (黄灯 🟡)",
			"settings.warningHint": "当余额低于此值时显示黄色预警状态。",
			"settings.danger": "告急阈值 (红灯 🔴)",
			"settings.dangerHint": "当余额低于此值时显示红色告急状态。",
			"settings.sliderHint": "💡 拖动手柄或点击轨道设置告急线与预警线：",
			"settings.serverInterval": "服务端查询间隔",
			"settings.provider": "额度数据源",
			"settings.provider.deepseek": "DeepSeek 官方余额",
			"settings.provider.opencode": "OpenCode Go 订阅用量",
			"settings.providerHintFollow": "无法识别当前对话模型时，用此项作为回退。",
			"settings.providerHintCustom": "自定义模式下始终展示此项，忽略当前对话模型。",
			"settings.opencodeApiKeyRef": "OpenCode Go 凭证引用名",
			"settings.opencodeApiKeyRefHint": "优先从 credentials / 环境变量读取此名称。",
			"settings.opencodeApiKey": "OpenCode Go API Key",
			"settings.opencodeApiKeyHint": "留空则读取 OPENCODE_GO_API_KEY 或 OpenCode auth.json。",
			"settings.opencodeBaseUrl": "OpenCode Go Usage API",
			"settings.opencodeBaseUrlHint": "官方接口见 https://opencode.ai/zen/go/v1/usage",
			"settings.serverIntervalHintQuota": "后台向 OpenCode Go 查询真实用量的频率。",
			"settings.warningPercent": "剩余额度预警阈值 (黄灯 🟡)",
			"settings.dangerPercent": "剩余额度告急阈值 (红灯 🔴)",
			"settings.warningHintQuota": "剩余额度低于此百分比时显示黄色预警状态。",
			"settings.dangerHintQuota": "剩余额度低于此百分比时显示红色告急状态。",
			"settings.serverIntervalHint": "后台向 DeepSeek 查询真实余额的频率。",
			"settings.clientInterval": "前端读取缓存间隔",
			"settings.clientIntervalHint": "浏览器从本地只读缓存拉取数据的频率。",
			"settings.pricingDesc": "配置各模型每 1M Token 的命中 / 未命中 / 输出单价：",
			"settings.pricingHit": "缓存命中",
			"settings.pricingMiss": "未命中",
			"settings.pricingOut": "输出",
			"settings.pricingReset": "恢复官方默认单价",
			"settings.addModel": "➕ 添加自定义模型",
			"settings.addModelName": "模型名称 (如 deepseek-chat)",
			"settings.btnAdd": "添加",
			"settings.exportDesc": "复制下方片段到 cordis.patch.yml 即可持久保存：",
			"settings.btnCopy": "📋 复制 YAML 配置",
			"settings.copied": "✓ 已复制到剪贴板！",
			"settings.btnResetAll": "恢复默认设置",
			"settings.resetConfirmTitle": "恢复默认设置？",
			"settings.resetConfirmBody": "表单会回到插件默认值，不会立刻写入。确认后请再点「保存并生效」。",
			"settings.resetConfirmOk": "恢复默认",
			"settings.resetConfirmCancel": "取消",
			"settings.btnSave": "保存并生效",
			"settings.saving": "正在保存...",
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
			"balanceError": "Balance unavailable",
			"balanceMissing": "API key not configured",
			"status.sufficient": "Sufficient",
			"status.warning": "Low",
			"status.danger": "Critical",
			"btn.refresh": "Click to refresh balance",
			"btn.refreshing": "Refreshing balance...",
			"sessionCost": "~{amount} this session",
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
			"card.error": "【Account Balance】Error: {error}",
			/* OpenCode Go quota translations */
			"quota.readout": "Go quota M {monthly} · W {weekly} · 5h {rolling}",
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
			"settings.tab.general": "🎯 General & Thresholds",
			"settings.tab.pricing": "⚡ Model Pricing",
			"settings.tab.export": "📋 YAML Export",
			"settings.showDock": "Bottom status bar",
			"settings.showDockHint": "Show quota and session cost under the composer. Turn off to keep only the Web UI stats.",
			"settings.dockLayout": "Status bar layout",
			"settings.dockLayout.own": "Own line",
			"settings.dockLayout.shared": "Share one line",
			"settings.dockLayoutHint": "Own line: credits sit on a row below the official stats. Share one line: append after official stats and TPS.",
			"settings.showCapsule": "Spend capsule",
			"settings.showCapsuleHint": "Draggable today / week / month spend tracker in the corner.",
			"settings.showPopover": "Hover details",
			"settings.showPopoverHint": "Show the balance / quota and session breakdown when hovering the bottom readout.",
			"settings.quotaMode": "Quota query mode",
			"settings.quotaMode.follow": "Follow current model provider",
			"settings.quotaMode.custom": "Custom fixed display",
			"settings.quotaModeHint": "Follow: Go models show subscription usage; other providers show the official balance. Custom: always use the source below, ignoring the current model.",
			"settings.currency": "Currency",
			"settings.currencyHint": "Used for session estimates and the status light. All wallets stay visible; switching loads that currency's official prices.",
			"settings.currencyHintQuota": "Does not change quota percent; only the session cost estimate.",
			"settings.warning": "Warning Threshold (Yellow 🟡)",
			"settings.warningHint": "Show yellow warning status when balance is below this value.",
			"settings.danger": "Danger Threshold (Red 🔴)",
			"settings.dangerHint": "Show red critical status when balance is below this value.",
			"settings.sliderHint": "💡 Drag handles or click the track to set danger and warning lines:",
			"settings.serverInterval": "Server Refresh Interval",
			"settings.provider": "Quota Source",
			"settings.provider.deepseek": "DeepSeek official balance",
			"settings.provider.opencode": "OpenCode Go subscription usage",
			"settings.providerHintFollow": "Used only when the current chat model cannot be identified.",
			"settings.providerHintCustom": "In custom mode this source is always shown, ignoring the current chat model.",
			"settings.opencodeApiKeyRef": "OpenCode Go Credential Ref",
			"settings.opencodeApiKeyRefHint": "Resolved from the credentials seam / environment by this name.",
			"settings.opencodeApiKey": "OpenCode Go API Key",
			"settings.opencodeApiKeyHint": "Leave empty to read OPENCODE_GO_API_KEY or OpenCode auth.json.",
			"settings.opencodeBaseUrl": "OpenCode Go Usage API",
			"settings.opencodeBaseUrlHint": "Official endpoint: https://opencode.ai/zen/go/v1/usage.",
			"settings.serverIntervalHintQuota": "Interval for backend querying OpenCode Go usage.",
			"settings.warningPercent": "Remaining quota warning threshold (Yellow 🟡)",
			"settings.dangerPercent": "Remaining quota danger threshold (Red 🔴)",
			"settings.warningHintQuota": "Show yellow warning when remaining quota is below this percent.",
			"settings.dangerHintQuota": "Show red critical when remaining quota is below this percent.",
			"settings.serverIntervalHint": "Interval for backend querying DeepSeek balance API.",
			"settings.clientInterval": "Client Poll Interval",
			"settings.clientIntervalHint": "Interval for frontend fetching local cache from backend.",
			"settings.pricingDesc": "Configure price per 1M tokens for each model:",
			"settings.pricingHit": "Cache Hit",
			"settings.pricingMiss": "Cache Miss",
			"settings.pricingOut": "Output",
			"settings.pricingReset": "Reset to Default Rates",
			"settings.addModel": "➕ Add Custom Model",
			"settings.addModelName": "Model Name (e.g. deepseek-chat)",
			"settings.btnAdd": "Add",
			"settings.exportDesc": "Copy the snippet below into cordis.patch.yml to persist settings:",
			"settings.btnCopy": "📋 Copy YAML",
			"settings.copied": "✓ Copied to clipboard!",
			"settings.btnResetAll": "Reset All to Default",
			"settings.resetConfirmTitle": "Reset to defaults?",
			"settings.resetConfirmBody": "The form will return to plugin defaults and will not be written until you save.",
			"settings.resetConfirmOk": "Reset",
			"settings.resetConfirmCancel": "Cancel",
			"settings.btnSave": "Save Changes",
			"settings.saving": "Saving...",
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
			"deepseek-v4-flash": { cacheHit: 0.02, cacheMiss: 1, output: 2 },
			"deepseek-v4-pro": { cacheHit: 0.025, cacheMiss: 3, output: 6 },
			"deepseek-chat": { cacheHit: 0.1, cacheMiss: 1, output: 2 },
			"deepseek-reasoner": { cacheHit: 1, cacheMiss: 4, output: 16 }
		};
		const DEFAULT_PRICES_USD = {
			"deepseek-v4-flash": { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
			"deepseek-v4-pro": { cacheHit: 0.0035, cacheMiss: 0.42, output: 0.84 },
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
			quotaMode: "follow",
			showDock: true,
			dockLayout: "own",
			showCapsule: true,
			showPopover: true,
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
			defaultPrices: officialDefaultPrices("CNY")
		};

		function generateYaml(config) {
			const isOpencode = config.provider === "opencode-go";
			const lines = [
				"- id: dsh-credits",
				"  config:",
				`    quotaMode: ${config.quotaMode === "custom" ? "custom" : "follow"}`,
				`    showDock: ${config.showDock !== false}`,
				`    dockLayout: ${normalizeDockLayout(config.dockLayout)}`,
				`    showCapsule: ${config.showCapsule !== false}`,
				`    showPopover: ${config.showPopover !== false}`,
				`    provider: ${config.provider}`,
				`    dangerThreshold: ${config.dangerThreshold}`,
				`    warningThreshold: ${config.warningThreshold}`,
				`    refreshIntervalMs: ${config.refreshIntervalMs}`,
				`    clientPollIntervalMs: ${config.clientPollIntervalMs}`,
				`    currency: ${config.currency}`
			];
			if (isOpencode) {
				lines.push(`    opencodeApiKeyRef: ${config.opencodeApiKeyRef}`);
				lines.push(`    opencodeBaseUrl: ${config.opencodeBaseUrl}`);
			} else {
				lines.push("    apiKeyRef: DEEPSEEK_API_KEY");
				lines.push(`    baseUrl: ${config.baseUrl}`);
			}
			lines.push("    prices:");
			for (const [m, p] of Object.entries(config.prices || {})) {
				lines.push(`      ${m}: { cacheHit: ${p.cacheHit}, cacheMiss: ${p.cacheMiss}, output: ${p.output} }`);
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

		function SettingsPanel({ t }) {
			// Tab 顺序: 常规与阈值 -> 模型单价 -> YAML导出
			const [activeTab, setActiveTab] = react.useState("general");
			const [form, setForm] = react.useState(DEFAULT_SETTINGS);
			const [saving, setSaving] = react.useState(false);
			const [toast, setToast] = react.useState(null);
			const [copied, setCopied] = react.useState(false);
			const [resetOpen, setResetOpen] = react.useState(false);

			// 自定义新增模型表单字段
			const [newModelName, setNewModelName] = react.useState("");
			const [newModelHit, setNewModelHit] = react.useState(0.1);
			const [newModelMiss, setNewModelMiss] = react.useState(1.0);
			const [newModelOut, setNewModelOut] = react.useState(2.0);

			react.useEffect(() => {
				fetch("/query-credits/config", { cache: "no-store" })
					.then((r) => r.json())
					.then((data) => {
						if (data && data.ok && data.config) {
							const c = data.config;
							const loadedPrices = (c.prices && Object.keys(c.prices).length > 0) ? { ...c.prices } : { ...DEFAULT_PRICES };
							setForm({
								quotaMode: c.quotaMode === "custom" ? "custom" : "follow",
								showDock: c.showDock !== false,
								dockLayout: normalizeDockLayout(c.dockLayout),
								showCapsule: c.showCapsule !== false,
								showPopover: c.showPopover !== false,
								provider: c.provider === "opencode-go" ? "opencode-go" : "deepseek",
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
								prices: loadedPrices,
								defaultPrices: c.defaultPrices ?? officialDefaultPrices(c.currency ?? "CNY")
							});
						}
					})
					.catch(() => {});
			}, []);

			const showToast = (msg) => {
				setToast(msg);
				setTimeout(() => setToast(null), 2500);
			};

			const handleSave = async () => {
				setSaving(true);
				try {
					const payload = {
						...form,
						quotaMode: form.quotaMode === "custom" ? "custom" : "follow",
						showDock: form.showDock !== false,
						dockLayout: normalizeDockLayout(form.dockLayout),
						showCapsule: form.showCapsule !== false,
						showPopover: form.showPopover !== false,
						provider: form.provider === "opencode-go" ? "opencode-go" : "deepseek",
						warningThreshold: Number(form.warningThreshold),
						dangerThreshold: Number(form.dangerThreshold),
						refreshIntervalMs: Number(form.refreshIntervalMs),
						clientPollIntervalMs: Number(form.clientPollIntervalMs),
						timeoutMs: Number(form.timeoutMs),
						opencodeApiKeyRef: String(form.opencodeApiKeyRef ?? "").trim(),
						opencodeBaseUrl: String(form.opencodeBaseUrl ?? "").trim(),
					};
					// 空密钥不提交, 避免覆盖服务端已配置的 apiKey / opencodeApiKey。
					if (String(form.apiKey ?? "").trim() !== "") payload.apiKey = String(form.apiKey).trim();
					else delete payload.apiKey;
					if (String(form.opencodeApiKey ?? "").trim() !== "") payload.opencodeApiKey = String(form.opencodeApiKey).trim();
					else delete payload.opencodeApiKey;
					const res = await fetch("/query-credits/config", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(payload)
					});
					const data = await res.json();
					if (data.ok) {
						showToast(t("settings.savedToast"));
						void balanceStore.forceRefresh();
						void spendStore.refresh();
					} else {
						alert("Save failed: " + (data.error || "unknown error"));
					}
				} catch (err) {
					alert("Save failed: " + (err.message || String(err)));
				} finally {
					setSaving(false);
				}
			};

			const handleCopyYaml = () => {
				const yaml = generateYaml(form);
				if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(yaml).then(() => {
						setCopied(true);
						showToast(t("settings.copied"));
						setTimeout(() => setCopied(false), 2000);
					});
				}
			};

			const handleResetAll = () => setResetOpen(true);
			const confirmResetAll = () => {
				setForm({ ...DEFAULT_SETTINGS, prices: { ...DEFAULT_PRICES } });
				setResetOpen(false);
			};

			const handleResetPricing = () => {
				setForm((prev) => ({ ...prev, prices: { ...DEFAULT_PRICES } }));
			};

			const handleAddModel = () => {
				const name = newModelName.trim();
				if (!name) return;
				setForm((prev) => ({
					...prev,
					prices: {
						...prev.prices,
						[name]: {
							cacheHit: Number(newModelHit),
							cacheMiss: Number(newModelMiss),
							output: Number(newModelOut)
						}
					}
				}));
				setNewModelName("");
			};

			const handleDeleteModel = (modelName) => {
				setForm((prev) => {
					const next = { ...prev.prices };
					delete next[modelName];
					return { ...prev, prices: next };
				});
			};

			return react.createElement("div", {
				className: "dshqb_settings_page"
			}, [
					react.createElement("div", { className: "dshqb_modal_header", key: "hdr" }, [
						react.createElement("span", { key: "title" }, t("settings.title"))
					]),
					// 2. Tabs (常规与阈值 -> 模型单价 -> YAML导出)
					react.createElement("div", { className: "dshqb_modal_tabs", key: "tabs" }, [
						react.createElement("button", {
							className: "dshqb_modal_tab" + (activeTab === "general" ? " dshqb_modal_tab_active" : ""),
							onClick: () => setActiveTab("general"),
							key: "tab_general"
						}, t("settings.tab.general")),
						react.createElement("button", {
							className: "dshqb_modal_tab" + (activeTab === "pricing" ? " dshqb_modal_tab_active" : ""),
							onClick: () => setActiveTab("pricing"),
							key: "tab_pricing"
						}, t("settings.tab.pricing")),
						react.createElement("button", {
							className: "dshqb_modal_tab" + (activeTab === "export" ? " dshqb_modal_tab_active" : ""),
							onClick: () => setActiveTab("export"),
							key: "tab_export"
						}, t("settings.tab.export"))
					]),
					// 3. Body
					react.createElement("div", { className: "dshqb_modal_body", key: "body" }, [
						// Tab 1: 常规与阈值 (告急阈值在前，预警阈值在后，支持拖拽设置)
						activeTab === "general" ? react.createElement("div", { className: "dshqb_col", key: "general_content" }, [
							react.createElement("div", { className: "dshqb_toggle_list", key: "display" }, [
								["showDock", "settings.showDock", "settings.showDockHint"],
								["showCapsule", "settings.showCapsule", "settings.showCapsuleHint"],
								["showPopover", "settings.showPopover", "settings.showPopoverHint"]
							].map(([field, labelKey, hintKey]) =>
								react.createElement("label", { className: "dshqb_toggle_row", key: field }, [
									react.createElement("span", { className: "dshqb_toggle_copy", key: "txt" }, [
										react.createElement("span", { className: "dshqb_form_label", key: "l" }, t(labelKey)),
										react.createElement("span", { className: "dshqb_form_hint", key: "h" }, t(hintKey))
									]),
									react.createElement("input", {
										type: "checkbox",
										className: "dshqb_check",
										checked: form[field] !== false,
										onChange: (e) => setForm({ ...form, [field]: e.target.checked }),
										key: "chk"
									})
								])
							)),
							react.createElement("div", { className: "dshqb_form_group", key: "dockLayout" }, [
								react.createElement("label", { className: "dshqb_form_label", key: "lbl" }, t("settings.dockLayout")),
								react.createElement("select", {
									className: "dshqb_select",
									value: normalizeDockLayout(form.dockLayout),
									disabled: form.showDock === false,
									onChange: (e) => setForm({ ...form, dockLayout: normalizeDockLayout(e.target.value) }),
									key: "sel"
								}, [
									react.createElement("option", { value: "own", key: "own" }, t("settings.dockLayout.own")),
									react.createElement("option", { value: "shared", key: "shared" }, t("settings.dockLayout.shared"))
								]),
								react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, t("settings.dockLayoutHint"))
							]),
							react.createElement("div", { className: "dshqb_form_group", key: "quotaMode" }, [
								react.createElement("label", { className: "dshqb_form_label", key: "lbl" }, t("settings.quotaMode")),
								react.createElement("select", {
									className: "dshqb_select",
									value: form.quotaMode === "custom" ? "custom" : "follow",
									onChange: (e) => setForm({ ...form, quotaMode: e.target.value === "custom" ? "custom" : "follow" }),
									key: "sel"
								}, [
									react.createElement("option", { value: "follow", key: "follow" }, t("settings.quotaMode.follow")),
									react.createElement("option", { value: "custom", key: "custom" }, t("settings.quotaMode.custom"))
								]),
								react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, t("settings.quotaModeHint"))
							]),
							react.createElement("div", { className: "dshqb_form_group", key: "provider" }, [
								react.createElement("label", { className: "dshqb_form_label", key: "lbl" }, t("settings.provider")),
								react.createElement("select", {
									className: "dshqb_select",
									value: form.provider,
									onChange: (e) => setForm({ ...form, provider: e.target.value === "opencode-go" ? "opencode-go" : "deepseek" }),
									key: "sel"
								}, [
									react.createElement("option", { value: "deepseek", key: "ds" }, t("settings.provider.deepseek")),
									react.createElement("option", { value: "opencode-go", key: "oc" }, t("settings.provider.opencode"))
								]),
								react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, t(form.quotaMode === "custom" ? "settings.providerHintCustom" : "settings.providerHintFollow"))
							]),
							react.createElement("div", { className: "dshqb_form_group", key: "cur" }, [
								react.createElement("label", { className: "dshqb_form_label", key: "lbl" }, t("settings.currency")),
								react.createElement("select", {
									className: "dshqb_select",
									value: form.currency,
									onChange: (e) => {
										const next = e.target.value;
										setForm((prev) => {
											const official = officialPricesFor(next);
											const prices = { ...(prev.prices || {}) };
											for (const [model, p] of Object.entries(official)) prices[model] = p;
											return { ...prev, currency: next, prices, defaultPrices: officialDefaultPrices(next) };
										});
									},
									key: "sel"
								}, [
									react.createElement("option", { value: "CNY", key: "cny" }, "CNY (人民币 ¥)"),
									react.createElement("option", { value: "USD", key: "usd" }, "USD (美元 $)"),
									react.createElement("option", { value: "EUR", key: "eur" }, "EUR (欧元 €)")
								]),
								react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, t(form.provider === "opencode-go" ? "settings.currencyHintQuota" : "settings.currencyHint"))
							]),
							// OpenCode Go 专属配置
							form.quotaMode === "follow" || form.provider === "opencode-go" ? react.createElement("div", { className: "dshqb_col", key: "opencode_fields" }, [
								react.createElement("div", { className: "dshqb_form_group", key: "oc_base" }, [
									react.createElement("label", { className: "dshqb_form_label", key: "lbl" }, t("settings.opencodeBaseUrl")),
									react.createElement("input", {
										type: "text",
										className: "dshqb_input",
										value: form.opencodeBaseUrl,
										onChange: (e) => setForm({ ...form, opencodeBaseUrl: e.target.value }),
										key: "inp"
									}),
									react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, t("settings.opencodeBaseUrlHint"))
								]),
								react.createElement("div", { className: "dshqb_grid_2", key: "oc_keys" }, [
									react.createElement("div", { className: "dshqb_form_group", key: "oc_ref" }, [
										react.createElement("label", { className: "dshqb_form_label", key: "lbl" }, t("settings.opencodeApiKeyRef")),
										react.createElement("input", {
											type: "text",
											className: "dshqb_input",
											value: form.opencodeApiKeyRef,
											onChange: (e) => setForm({ ...form, opencodeApiKeyRef: e.target.value }),
											key: "inp"
										}),
										react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, t("settings.opencodeApiKeyRefHint"))
									]),
									react.createElement("div", { className: "dshqb_form_group", key: "oc_key" }, [
										react.createElement("label", { className: "dshqb_form_label", key: "lbl" }, t("settings.opencodeApiKey")),
										react.createElement("input", {
											type: "password",
											className: "dshqb_input",
											placeholder: "sk-opencode-…",
											value: form.opencodeApiKey,
											onChange: (e) => setForm({ ...form, opencodeApiKey: e.target.value }),
											key: "inp"
										}),
										react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, t("settings.opencodeApiKeyHint"))
									])
								]),
							]) : null,
							// 交互式滑块条组件
							react.createElement(InteractiveThresholdSlider, {
								danger: form.dangerThreshold,
								warning: form.warningThreshold,
								currency: form.currency,
								percentMode: form.provider === "opencode-go",
								onChange: (nextDanger, nextWarning) => {
									setForm((prev) => ({
										...prev,
										dangerThreshold: nextDanger,
										warningThreshold: nextWarning
									}));
								},
								t,
								key: "slider"
							}),
							// 阈值数值输入框 (左: 告急阈值, 右: 预警阈值)
							react.createElement("div", { className: "dshqb_grid_2", key: "thresh_grid" }, [
								react.createElement("div", { className: "dshqb_form_group", key: "dang" }, [
									react.createElement("label", { className: "dshqb_form_label", key: "lbl" }, t(form.provider === "opencode-go" ? "settings.dangerPercent" : "settings.danger")),
									react.createElement("input", {
										type: "number",
										className: "dshqb_input",
										value: form.dangerThreshold,
										onChange: (e) => setForm({ ...form, dangerThreshold: Number(e.target.value) }),
										key: "inp"
									}),
									react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, t(form.provider === "opencode-go" ? "settings.dangerHintQuota" : "settings.dangerHint"))
								]),
								react.createElement("div", { className: "dshqb_form_group", key: "warn" }, [
									react.createElement("label", { className: "dshqb_form_label", key: "lbl" }, t(form.provider === "opencode-go" ? "settings.warningPercent" : "settings.warning")),
									react.createElement("input", {
										type: "number",
										className: "dshqb_input",
										value: form.warningThreshold,
										onChange: (e) => setForm({ ...form, warningThreshold: Number(e.target.value) }),
										key: "inp"
									}),
									react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, t(form.provider === "opencode-go" ? "settings.warningHintQuota" : "settings.warningHint"))
								])
							]),
							react.createElement("div", { className: "dshqb_grid_2", key: "int_grid" }, [
								react.createElement("div", { className: "dshqb_form_group", key: "server_int" }, [
									react.createElement("label", { className: "dshqb_form_label", key: "lbl" }, t("settings.serverInterval")),
									react.createElement("select", {
										className: "dshqb_select",
										value: form.refreshIntervalMs,
										onChange: (e) => setForm({ ...form, refreshIntervalMs: Number(e.target.value) }),
										key: "sel"
									}, [
										react.createElement("option", { value: 60000, key: "1m" }, "1 分钟 (高频)"),
										react.createElement("option", { value: 180000, key: "3m" }, "3 分钟"),
										react.createElement("option", { value: 300000, key: "5m" }, "5 分钟 (推荐)"),
										react.createElement("option", { value: 600000, key: "10m" }, "10 分钟")
									]),
									react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, t(form.provider === "opencode-go" ? "settings.serverIntervalHintQuota" : "settings.serverIntervalHint"))
								]),
								react.createElement("div", { className: "dshqb_form_group", key: "client_int" }, [
									react.createElement("label", { className: "dshqb_form_label", key: "lbl" }, t("settings.clientInterval")),
									react.createElement("select", {
										className: "dshqb_select",
										value: form.clientPollIntervalMs,
										onChange: (e) => setForm({ ...form, clientPollIntervalMs: Number(e.target.value) }),
										key: "sel"
									}, [
										react.createElement("option", { value: 10000, key: "10s" }, "10 秒"),
										react.createElement("option", { value: 30000, key: "30s" }, "30 秒 (推荐)"),
										react.createElement("option", { value: 60000, key: "60s" }, "60 秒")
									]),
									react.createElement("span", { className: "dshqb_form_hint", key: "hint" }, t("settings.clientIntervalHint"))
								])
							])
						]) : null,

						// Tab 2: 模型单价 (默认显示 V4 并支持手动添加自定义模型)
						activeTab === "pricing" ? react.createElement("div", { className: "dshqb_col", key: "pricing_content" }, [
							react.createElement("div", { className: "dshqb_form_label_row", key: "p_head" }, [
								react.createElement("span", { className: "dshqb_form_hint", key: "desc" }, t("settings.pricingDesc")),
								react.createElement("button", {
									type: "button",
									className: "dshqb_btn dshqb_btn_outline",
									style: { padding: "3px 8px", fontSize: "11px" },
									onClick: handleResetPricing,
									key: "p_reset"
								}, t("settings.pricingReset"))
							]),
							react.createElement("table", { className: "dshqb_pricing_table", key: "p_table" }, [
								react.createElement("thead", { key: "th" }, [
									react.createElement("tr", { key: "r" }, [
										react.createElement("th", { key: "m" }, "Model"),
										react.createElement("th", { key: "hit" }, t("settings.pricingHit") + " (" + form.currency + ")"),
										react.createElement("th", { key: "miss" }, t("settings.pricingMiss") + " (" + form.currency + ")"),
										react.createElement("th", { key: "out" }, t("settings.pricingOut") + " (" + form.currency + ")"),
										react.createElement("th", { style: { width: "32px" }, key: "act" }, "")
									])
								]),
								react.createElement("tbody", { key: "tb" },
									Object.entries(form.prices || {}).map(([model, rates]) =>
										react.createElement("tr", { key: model }, [
											react.createElement("td", { style: { fontWeight: "600" }, key: "m_name" }, model),
											react.createElement("td", { key: "m_hit" }, [
												react.createElement("input", {
													type: "number",
													step: "0.001",
													className: "dshqb_input dshqb_input_num",
													value: rates.cacheHit,
													onChange: (e) => {
														const val = Number(e.target.value);
														setForm({
															...form,
															prices: { ...form.prices, [model]: { ...rates, cacheHit: val } }
														});
													}
												})
											]),
											react.createElement("td", { key: "m_miss" }, [
												react.createElement("input", {
													type: "number",
													step: "0.01",
													className: "dshqb_input dshqb_input_num",
													value: rates.cacheMiss,
													onChange: (e) => {
														const val = Number(e.target.value);
														setForm({
															...form,
															prices: { ...form.prices, [model]: { ...rates, cacheMiss: val } }
														});
													}
												})
											]),
											react.createElement("td", { key: "m_out" }, [
												react.createElement("input", {
													type: "number",
													step: "0.01",
													className: "dshqb_input dshqb_input_num",
													value: rates.output,
													onChange: (e) => {
														const val = Number(e.target.value);
														setForm({
															...form,
															prices: { ...form.prices, [model]: { ...rates, output: val } }
														});
													}
												})
											]),
											react.createElement("td", { key: "m_del" }, [
												!model.toLowerCase().includes("v4") ? react.createElement("button", {
													type: "button",
													className: "dshqb_btn_del",
													onClick: () => handleDeleteModel(model),
													title: "移除该模型",
													key: "del"
												}, "🗑️") : null
											])
										])
									)
								)
							]),
							// 手动添加自定义模型栏
							react.createElement("div", { className: "dshqb_add_model_box", key: "add_box" }, [
								react.createElement("input", {
									type: "text",
									className: "dshqb_input",
									style: { flex: 2 },
									placeholder: t("settings.addModelName"),
									value: newModelName,
									onChange: (e) => setNewModelName(e.target.value),
									key: "inp_name"
								}),
								react.createElement("input", {
									type: "number",
									step: "0.01",
									className: "dshqb_input dshqb_input_num",
									title: t("settings.pricingHit"),
									placeholder: "命中",
									value: newModelHit,
									onChange: (e) => setNewModelHit(Number(e.target.value)),
									key: "inp_hit"
								}),
								react.createElement("input", {
									type: "number",
									step: "0.01",
									className: "dshqb_input dshqb_input_num",
									title: t("settings.pricingMiss"),
									placeholder: "未命中",
									value: newModelMiss,
									onChange: (e) => setNewModelMiss(Number(e.target.value)),
									key: "inp_miss"
								}),
								react.createElement("input", {
									type: "number",
									step: "0.01",
									className: "dshqb_input dshqb_input_num",
									title: t("settings.pricingOut"),
									placeholder: "输出",
									value: newModelOut,
									onChange: (e) => setNewModelOut(Number(e.target.value)),
									key: "inp_out"
								}),
								react.createElement("button", {
									type: "button",
									className: "dshqb_btn dshqb_btn_secondary",
									onClick: handleAddModel,
									key: "btn_add"
								}, t("settings.btnAdd"))
							])
						]) : null,

						// Tab 3: YAML 导出
						activeTab === "export" ? react.createElement("div", { className: "dshqb_col", key: "export_content" }, [
							react.createElement("span", { className: "dshqb_form_hint", key: "desc" }, t("settings.exportDesc")),
							react.createElement("pre", { className: "dshqb_code_block", key: "code" }, generateYaml(form)),
							react.createElement("div", { style: { display: "flex", justifyContent: "flex-end" }, key: "act" }, [
								react.createElement("button", {
									type: "button",
									className: "dshqb_btn dshqb_btn_secondary",
									onClick: handleCopyYaml,
									key: "btn_copy"
								}, copied ? t("settings.copied") : t("settings.btnCopy"))
							])
						]) : null
					]),
					// 4. Footer
					react.createElement("div", { className: "dshqb_modal_footer", key: "ftr" }, [
						react.createElement("button", {
							type: "button",
							className: "dshqb_btn dshqb_btn_outline",
							onClick: handleResetAll,
							key: "btn_reset"
						}, t("settings.btnResetAll")),
						react.createElement("button", {
							type: "button",
							className: "dshqb_btn dshqb_btn_primary",
							onClick: handleSave,
							disabled: saving,
							key: "btn_save"
						}, saving ? t("settings.saving") : t("settings.btnSave"))
					]),
				resetOpen ? react.createElement("div", {
					className: "dshqb_confirm_mask",
					key: "reset_mask",
					onClick: (e) => {
						if (e.target === e.currentTarget) setResetOpen(false);
					}
				}, react.createElement("div", {
					className: "dshqb_confirm",
					role: "dialog",
					"aria-modal": "true",
					"aria-labelledby": "dshqb-reset-title"
				}, [
					react.createElement("div", { className: "dshqb_confirm_title", id: "dshqb-reset-title", key: "t" }, t("settings.resetConfirmTitle")),
					react.createElement("div", { className: "dshqb_confirm_body", key: "b" }, t("settings.resetConfirmBody")),
					react.createElement("div", { className: "dshqb_confirm_actions", key: "a" }, [
						react.createElement("button", {
							type: "button",
							className: "dshqb_btn dshqb_btn_secondary",
							onClick: () => setResetOpen(false),
							key: "cancel"
						}, t("settings.resetConfirmCancel")),
						react.createElement("button", {
							type: "button",
							className: "dshqb_btn dshqb_btn_primary",
							onClick: confirmResetAll,
							key: "ok"
						}, t("settings.resetConfirmOk"))
					])
				])) : null,
				toast ? react.createElement("div", { className: "dshqb_toast", key: "toast" }, toast) : null
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
		function opencodeWindowName(key, t) {
			return key === "rolling" ? t("quota.rolling") : key === "weekly" ? t("quota.weekly") : t("quota.monthly");
		}
		/** OpenCode Go 用量 → 剩余额度状态(取三个窗口中剩余最少者)。 */
		function opencodeQuotaStatus(usage, thresholds) {
			const remaining = OPENCODE_WINDOW_KEYS
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
			const quotaSource = resolveQuotaSource(modelProvider, {
				quotaMode: payload?.quotaMode,
				provider: fallbackProvider
			});
			const showDock = payload?.showDock !== false;
			const dockLayout = normalizeDockLayout(payload?.dockLayout);
			const showCapsule = payload?.showCapsule !== false;
			const showPopover = payload?.showPopover !== false;
			const cost = priceSession(rawCost, payload);
			const rootRef = react.useRef(null);

			const isRefreshing = balance.isRefreshing === true;
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
			if (balance.status === "ok") {
				const info = mergeQuotaView(balance.payload, quotaSource);
				if (info.provider === "opencode-go" && info.ok === true && info.usage) {
					const usage = info.usage || {};
					const quota = opencodeQuotaStatus(usage, info.thresholds);
					const level = quota.available ? quota.level : "danger";
					const levelText = level === "success" ? t("status.sufficient") : level === "warning" ? t("status.warning") : t("status.danger");
					const statusDot = react.createElement("button", {
						type: "button",
						className: "dshqb_dot dshqb_dot_btn dshqb_dot_" + level + (isRefreshing ? " dshqb_dot_loading" : ""),
						"aria-label": isRefreshing ? t("btn.refreshingQuota") : t("btn.refreshQuota"),
						title: isRefreshing ? t("btn.refreshingQuota") : t("btn.refreshQuota"),
						onClick: handleRefresh,
						disabled: isRefreshing
					});
					balNode = react.createElement("span", { className: "dshqb_amount", key: "bal" }, statusDot, t("quota.readout", {
						monthly: formatPercent(usage.monthly?.percent),
						weekly: formatPercent(usage.weekly?.percent),
						rolling: formatPercent(usage.rolling?.percent)
					}));
					leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
						react.createElement("div", { className: "dshqb_card_header", key: "head" }, [
							react.createElement("span", { className: "dshqb_card_title", key: "title" }, t("quota.cardTitle")),
							react.createElement("button", {
								type: "button",
								className: "dshqb_card_badge dshqb_card_badge_btn dshqb_card_badge_" + level,
								key: "badge",
								onClick: handleRefresh,
								disabled: isRefreshing,
								title: isRefreshing ? t("btn.refreshingQuota") : t("btn.refreshQuota")
							}, quota.available ? t("quota.remaining", { percent: formatPercent(quota.minRemaining) }) : t("quota.unavailable"))
						]),
						react.createElement("div", { className: "dshqb_quota_rows", key: "rows" },
							OPENCODE_WINDOW_KEYS.map((key) => {
								const w = usage[key] || {};
								const wLevel = opencodeWindowLevel(w.percent, info.thresholds);
								const pct = Number.isFinite(w.percent) ? Math.max(0, Math.min(100, w.percent)) : 0;
								return react.createElement("div", { className: "dshqb_quota_row", key },
									react.createElement("div", { className: "dshqb_quota_head", key: "head" }, [
										react.createElement("span", { className: "dshqb_quota_name", key: "name" }, opencodeWindowName(key, t)),
										react.createElement("button", {
											type: "button",
											className: "dshqb_quota_pct dshqb_quota_pct_btn",
											key: "pct",
											onClick: handleRefresh,
											disabled: isRefreshing,
											title: isRefreshing ? t("btn.refreshingQuota") : t("btn.refreshQuota")
										}, formatPercent(w.percent))
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
				} else if (info.provider === "opencode-go") {
					const message = info.error === "api-key-missing" ? t("balanceMissing") : t("quota.unavailable");
					const statusDot = react.createElement("button", {
						type: "button",
						className: "dshqb_dot dshqb_dot_btn dshqb_dot_danger" + (isRefreshing ? " dshqb_dot_loading" : ""),
						"aria-label": isRefreshing ? t("btn.refreshingQuota") : t("btn.refreshQuota"),
						title: isRefreshing ? t("btn.refreshingQuota") : t("btn.refreshQuota"),
						onClick: handleRefresh,
						disabled: isRefreshing
					});
					balNode = react.createElement("span", { className: "dshqb_error", key: "bal" }, statusDot, message);
					leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
						react.createElement("div", { className: "dshqb_card_header", key: "head" }, react.createElement("span", { className: "dshqb_card_title" }, t("quota.cardTitle"))),
						react.createElement("div", { className: "dshqb_card_sub", key: "err" }, t("quota.error", { error: typeof info.error === "string" ? info.error : message }))
					]);
				} else if (info.ok === true && Array.isArray(info.balances) && info.balances.length > 0) {
					const wallets = selectWallets(info.balances, info.currency);
					const primary = wallets.statusWallet ?? info.balances[0];
					const amount = wallets.readout.map((w) => formatMoney(w.total, w.currency)).join(" · ");
					const level = getStatusLevel(primary.total, info.isAvailable === true, info.thresholds);
					const levelText = level === "success" ? t("status.sufficient") : level === "warning" ? t("status.warning") : t("status.danger");
					const statusDot = react.createElement("button", {
						type: "button",
						className: "dshqb_dot dshqb_dot_btn dshqb_dot_" + level + (isRefreshing ? " dshqb_dot_loading" : ""),
						"aria-label": isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
						title: isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
						onClick: handleRefresh,
						disabled: isRefreshing
					});
					balNode = react.createElement("span", { className: "dshqb_amount", key: "bal" }, statusDot, t("balance", { amount }));

					leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
						react.createElement("div", { className: "dshqb_card_header", key: "head" }, [
							react.createElement("span", { className: "dshqb_card_title", key: "title" }, t("card.balanceTitle")),
							react.createElement("button", {
								type: "button",
								className: "dshqb_card_badge dshqb_card_badge_btn dshqb_card_badge_" + level,
								key: "badge",
								onClick: handleRefresh,
								disabled: isRefreshing,
								title: isRefreshing ? t("btn.refreshing") : t("btn.refresh")
							}, "● " + levelText)
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
				} else {
					const message = info.error === "api-key-missing" ? t("balanceMissing") : t("balanceError");
					const statusDot = react.createElement("button", {
						type: "button",
						className: "dshqb_dot dshqb_dot_btn dshqb_dot_danger" + (isRefreshing ? " dshqb_dot_loading" : ""),
						"aria-label": isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
						title: isRefreshing ? t("btn.refreshing") : t("btn.refresh"),
						onClick: handleRefresh,
						disabled: isRefreshing
					});
					balNode = react.createElement("span", { className: "dshqb_error", key: "bal" }, statusDot, message);
					leftCol = react.createElement("div", { className: "dshqb_col", key: "left" }, [
						react.createElement("div", { className: "dshqb_card_header", key: "head" }, react.createElement("span", { className: "dshqb_card_title" }, t("card.balanceTitle"))),
						react.createElement("div", { className: "dshqb_card_sub", key: "err" }, t("card.error", { error: typeof info.error === "string" ? info.error : message }))
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
					react.createElement("div", { key: "tip" }, quotaSource === "opencode-go" ? t("card.sessionHintQuota") : t("card.pricingHint"))
				])
			]);

			// 3. 定价策略 "?" 图标与毛玻璃卡片 (展示 V4 系列)
			let pricingNode = null;
			if (balance.status === "ok" && balance.payload !== null && quotaSource !== "opencode-go") {
				const payload = balance.payload;
				const currency = typeof payload.currency === "string" ? payload.currency : "CNY";
				const prices = payload.prices !== null && typeof payload.prices === "object" ? payload.prices : {};
				
				const v4Entries = Object.entries(prices).filter(([model]) =>
					model.toLowerCase().includes("v4")
				);
				const entriesToShow = v4Entries.length > 0 ? v4Entries : Object.entries(prices);

				const pricingPopover = react.createElement("div", {
					className: "dshqb_pricing_popover",
					key: "pricing_popover"
				}, [
					react.createElement("div", { className: "dshqb_card_header", key: "head" }, [
						react.createElement("span", { className: "dshqb_card_title", key: "title" }, t("pricing.title")),
						react.createElement("span", { className: "dshqb_card_badge dshqb_card_badge_info", key: "badge" }, t("pricing.rateBadge", { currency }))
					]),
					react.createElement("div", { className: "dshqb_pricing_models", key: "models" },
						entriesToShow.map(([model, p], idx) =>
							react.createElement("div", { className: "dshqb_pricing_card_item", key: idx }, [
								react.createElement("div", { className: "dshqb_pricing_model_name", key: "name" }, "• " + model),
								react.createElement("div", { className: "dshqb_pricing_rates", key: "rates" }, [
									react.createElement("span", { key: "hit" }, t("pricing.hit", { price: formatPrice(p.cacheHit, currency) })),
									react.createElement("span", { className: "dshqb_pricing_dot", key: "d1" }, "·"),
									react.createElement("span", { key: "miss" }, t("pricing.miss", { price: formatPrice(p.cacheMiss, currency) })),
									react.createElement("span", { className: "dshqb_pricing_dot", key: "d2" }, "·"),
									react.createElement("span", { key: "out" }, t("pricing.output", { price: formatPrice(p.output, currency) }))
								])
							])
						)
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
