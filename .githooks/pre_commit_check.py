#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pre-commit 核心逻辑：敏感信息扫描 + 文档完整性校验
由 .githooks/pre-commit (shell) 调用。自包含，不依赖外部脚本。
"""
import os, sys, re, subprocess

# === 敏感模式（匹配到即阻止提交）===
PATTERNS = [
    (r'-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----', '私钥文件内容'),
    (r'ghp_[A-Za-z0-9]{36}', 'GitHub Classic PAT'),
    (r'github_pat_[A-Za-z0-9_]{82}', 'GitHub Fine-grained PAT'),
    (r'sk-[A-Za-z0-9]{20,}', 'API Key (sk- 前缀)'),
    (r'AKIA[0-9A-Z]{16}', 'AWS Access Key'),
    (r'xox[baprs]-[A-Za-z0-9-]{10,}', 'Slack Token'),
    (r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}', 'JWT Token'),
    (r'(?i)(password|passwd|secret|token|api_key|apikey|private_key|access_key)\s*[:=]\s*["\']?[A-Za-z0-9+/=_\-]{8,}["\']?\s*$', '硬编码凭证（值非环境变量引用）'),
    (r'(?i)jdbc:(mysql|postgresql|mongodb)://[^:\s/]+:[^@\s]+@', '数据库连接串含明文密码'),
]

# 禁止提交的文件名/扩展名
BLOCKED_NAMES = {'.env', '.env.local', '.env.production', '.key', '.pem', '.p12', '.pfx'}
BLOCKED_EXTS = {'.key', '.pem', '.p12', '.pfx', '.crt'}

# 文档检查排除目录
EXCLUDE_DIRS = {'.git', 'node_modules', 'dist', 'build', 'target', '__pycache__', '.venv', 'venv', 'release'}


def get_repo_root():
    r = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True)
    return r.stdout.strip()


def get_staged_files():
    r = subprocess.run(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACM'],
                       capture_output=True, text=True)
    return [f.strip() for f in r.stdout.splitlines() if f.strip()]


def scan_staged_file(filepath):
    """扫描暂存区单个文件，返回问题列表"""
    issues = []
    basename = os.path.basename(filepath)
    ext = os.path.splitext(filepath)[1].lower()

    if basename in BLOCKED_NAMES or ext in BLOCKED_EXTS:
        issues.append(f"禁止提交敏感文件: {filepath}")
        return issues

    if ext in {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.zip', '.tar', '.gz'}:
        return issues

    try:
        r = subprocess.run(['git', 'show', f':{filepath}'], capture_output=True, text=True, errors='replace')
        content = r.stdout
    except Exception:
        return issues

    if len(content) > 500_000:
        return issues

    for pattern, desc in PATTERNS:
        if re.search(pattern, content, re.MULTILINE):
            issues.append(f"疑似{desc}: {filepath}")
            break
    return issues


def find_file_recursive(repo_root, names, max_depth=2):
    if isinstance(names, str):
        names = [names]
    for dirpath, dirnames, filenames in os.walk(repo_root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        depth = dirpath[len(repo_root):].count(os.sep)
        if depth > max_depth:
            dirnames[:] = []
            continue
        for n in names:
            if n in filenames:
                return True
    return False


def check_repo_docs(repo_root):
    issues = []
    if not find_file_recursive(repo_root, ['README.md', 'README']):
        issues.append("仓库缺少 README.md（递归检查）")
    if not find_file_recursive(repo_root, ['CLAUDE.md', 'AGENTS.md']):
        issues.append("仓库缺少 CLAUDE.md / AGENTS.md（递归检查）")
    if not find_file_recursive(repo_root, '.env.example'):
        issues.append("仓库缺少 .env.example（递归检查）")
    return issues


def main():
    repo_root = get_repo_root()
    if not repo_root:
        print("pre-commit: 非 git 仓库，终止")
        sys.exit(1)

    repo_name = os.path.basename(repo_root)
    staged = get_staged_files()

    if not staged:
        sys.exit(0)

    print(f"[pre-commit] 检查 {repo_name} — {len(staged)} 个暂存文件")

    all_issues = []
    for f in staged:
        all_issues.extend(scan_staged_file(f))

    code_exts = {'.py', '.js', '.ts', '.java', '.yml', '.yaml', '.json', '.vue', '.jsx', '.tsx'}
    has_code = any(os.path.splitext(f)[1].lower() in code_exts for f in staged)
    if has_code:
        all_issues.extend(check_repo_docs(repo_root))

    if all_issues:
        print(f"\n[pre-commit] 未通过（{len(all_issues)} 项）:")
        for issue in all_issues:
            print(f"  - {issue}")
        print("\n请修复后重试。如确需跳过: git commit --no-verify")
        sys.exit(1)

    print("[pre-commit] 通过")
    sys.exit(0)


if __name__ == '__main__':
    main()
