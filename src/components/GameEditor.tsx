import { useState } from 'react';
import { saveCustomSpec } from '../games/registry';
import type { CustomGameSpec } from '../games/types';

interface Props {
  onClose: (savedId?: string) => void;
}

/** 自定义游戏标准格式录入表单 */
export function GameEditor({ onClose }: Props) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    minPlayers: 2,
    maxPlayers: 4,
    rules: '',
    playerGoal: '',
    judgeGoal: '',
    winCondition: '',
  });
  const [err, setErr] = useState('');

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.name.trim()) return setErr('请填写游戏名称');
    if (!form.rules.trim()) return setErr('请填写游戏规则');
    if (!form.winCondition.trim()) return setErr('请填写胜负判定');
    const min = Math.max(2, Math.min(4, form.minPlayers));
    const max = Math.max(min, Math.min(4, form.maxPlayers));
    const spec: CustomGameSpec = {
      id: `custom_${Date.now()}`,
      name: form.name.trim(),
      description: form.description.trim(),
      minPlayers: min,
      maxPlayers: max,
      rules: form.rules.trim(),
      playerGoal: form.playerGoal.trim() || '按规则争取获胜。',
      judgeGoal: form.judgeGoal.trim(),
      winCondition: form.winCondition.trim(),
      createdAt: Date.now(),
    };
    saveCustomSpec(spec);
    onClose(spec.id);
  };

  return (
    <div className="modal-mask" onClick={() => onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>➕ 新增自定义游戏</h2>
        <p className="modal-tip">
          自定义游戏由<b>裁判 AI 主持</b>（必须配置裁判）：裁判负责叙述局面、安排行动顺序与裁决胜负。
        </p>
        {err && <div className="form-error">⚠️ {err}</div>}
        <label className="field">
          <span>游戏名称 *</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="如：猜数字大作战" />
        </label>
        <label className="field">
          <span>一句话简介</span>
          <input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="给设置页展示的简介" />
        </label>
        <div className="field-row">
          <label className="field">
            <span>最少玩家</span>
            <input
              type="number"
              min={2}
              max={4}
              value={form.minPlayers}
              onChange={(e) => set('minPlayers', Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>最多玩家</span>
            <input
              type="number"
              min={2}
              max={4}
              value={form.maxPlayers}
              onChange={(e) => set('maxPlayers', Number(e.target.value))}
            />
          </label>
        </div>
        <label className="field">
          <span>游戏规则（给 AI 学习的完整规则）*</span>
          <textarea
            rows={6}
            value={form.rules}
            onChange={(e) => set('rules', e.target.value)}
            placeholder={'例：裁判随机想一个 1~100 的整数。玩家轮流猜，裁判提示"大了/小了"……'}
          />
        </label>
        <label className="field">
          <span>玩家目标</span>
          <textarea rows={2} value={form.playerGoal} onChange={(e) => set('playerGoal', e.target.value)} placeholder="例：用最少的次数猜中数字，抢在对手之前。" />
        </label>
        <label className="field">
          <span>裁判目标</span>
          <textarea rows={2} value={form.judgeGoal} onChange={(e) => set('judgeGoal', e.target.value)} placeholder="例：心里记住谜底，诚实地提示大了/小了，不得泄题。" />
        </label>
        <label className="field">
          <span>胜负判定 *</span>
          <textarea rows={2} value={form.winCondition} onChange={(e) => set('winCondition', e.target.value)} placeholder="例：先猜中谜底者获胜。" />
        </label>
        <div className="modal-actions">
          <button className="btn" onClick={() => onClose()}>
            取消
          </button>
          <button className="btn primary" onClick={save}>
            保存游戏
          </button>
        </div>
      </div>
    </div>
  );
}
