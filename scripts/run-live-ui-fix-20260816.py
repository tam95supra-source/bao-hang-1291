from pathlib import Path

path = Path(__file__).with_name('apply-live-ui-fix-20260816.py')
source = path.read_text(encoding='utf-8')
opening = '    """    fun searchSkus(query: String, limit: Int = 20): List<SkuItem> {\n'
closing = '    fun skuCount""",\n)\n\n# 6) Reduce Realtime authorization noise on Android'
if source.count(opening) != 1 or source.count(closing) != 1:
    raise RuntimeError('Could not repair guarded patch delimiters exactly once')
source = source.replace(opening, "    '''    fun searchSkus(query: String, limit: Int = 20): List<SkuItem> {\n", 1)
source = source.replace(closing, "    fun skuCount''',\n)\n\n# 6) Reduce Realtime authorization noise on Android", 1)
code = compile(source, str(path), 'exec')
namespace = {'__file__': str(path), '__name__': '__main__'}
exec(code, namespace, namespace)
